import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

type MerchantVars = { merchantId: string; merchantEmail: string };

export const merchantPayouts = new Hono<{
  Bindings: Bindings;
  Variables: MerchantVars;
}>();

// ─── PUT /merchant/payout-settings ───────────────────────────────────────────

const payoutSettingsSchema = z.object({
  bankName: z.string().min(1, "Bank name is required"),
  accountHolder: z.string().min(1, "Account holder name is required"),
  accountNumber: z.string().min(4, "Account number is required"),
  routingNumber: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits"),
});

/**
 * Add or update the merchant's default payout account.
 * Only stores last 4 digits of account/routing numbers.
 */
merchantPayouts.put("/settings", zValidator("json", payoutSettingsSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const { bankName, accountHolder, accountNumber, routingNumber } = c.req.valid("json");

  const accountLast4 = accountNumber.slice(-4);
  const routingLast4 = routingNumber.slice(-4);

  // Check if a default payout account already exists
  const existing = await c.env.DB.prepare(
    "SELECT id FROM merchant_payouts WHERE merchant_id = ? AND is_default = 1"
  ).bind(merchantId).first<{ id: string }>();

  if (existing) {
    // Update existing
    await c.env.DB.prepare(
      `UPDATE merchant_payouts
       SET bank_name = ?, account_holder = ?, account_number_last4 = ?, routing_number_last4 = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(bankName, accountHolder, accountLast4, routingLast4, existing.id).run();

    return c.json(
      ok({
        id: existing.id,
        bank_name: bankName,
        account_holder: accountHolder,
        account_last4: accountLast4,
        routing_last4: routingLast4,
        verified: false,
        message: "Payout account updated.",
      })
    );
  } else {
    // Create new
    const payoutId = `payout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await c.env.DB.prepare(
      `INSERT INTO merchant_payouts (id, merchant_id, bank_name, account_holder, account_number_last4, routing_number_last4, is_default)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).bind(payoutId, merchantId, bankName, accountHolder, accountLast4, routingLast4).run();

    return c.json(
      ok({
        id: payoutId,
        bank_name: bankName,
        account_holder: accountHolder,
        account_last4: accountLast4,
        routing_last4: routingLast4,
        verified: false,
        message: "Payout account connected.",
      }),
      201
    );
  }
});

// ─── GET /merchant/payout-settings ───────────────────────────────────────────

/**
 * Get the merchant's default payout account.
 */
merchantPayouts.get("/settings", async (c) => {
  const merchantId = c.get("merchantId");

  const payout = await c.env.DB.prepare(
    `SELECT id, bank_name, account_holder, account_number_last4, routing_number_last4, is_default, verified, created_at
     FROM merchant_payouts WHERE merchant_id = ? AND is_default = 1 LIMIT 1`
  ).bind(merchantId).first();

  if (!payout) {
    return c.json(ok({ payout_account: null }));
  }

  return c.json(
    ok({
      payout_account: {
        id: payout.id,
        bank_name: payout.bank_name,
        account_holder: payout.account_holder,
        account_last4: payout.account_number_last4,
        routing_last4: payout.routing_number_last4,
        verified: payout.verified === 1,
        created_at: payout.created_at,
      },
    })
  );
});

// ─── POST /merchant/payouts ──────────────────────────────────────────────────

const payoutRequestSchema = z.object({
  amount: z.number().int().min(1000, "Minimum payout is $10.00"),
});

/**
 * Request a payout. Validates merchant has sufficient balance and a connected payout account.
 */
merchantPayouts.post("/", zValidator("json", payoutRequestSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const { amount } = c.req.valid("json");

  // Get merchant balance
  const merchant = await c.env.DB.prepare(
    "SELECT balance FROM merchants WHERE id = ?"
  ).bind(merchantId).first<{ balance: number }>();

  if (!merchant) {
    return c.json(err("Merchant not found"), 404);
  }

  if (merchant.balance < amount) {
    return c.json(err("Insufficient balance"), 400);
  }

  // Check for a connected payout account
  const payoutAccount = await c.env.DB.prepare(
    "SELECT id FROM merchant_payouts WHERE merchant_id = ? AND is_default = 1 LIMIT 1"
  ).bind(merchantId).first<{ id: string }>();

  if (!payoutAccount) {
    return c.json(err("No payout account connected. Add your bank details first."), 400);
  }

  // Check for existing pending payouts
  const pendingPayout = await c.env.DB.prepare(
    "SELECT id FROM payout_requests WHERE merchant_id = ? AND status IN ('pending', 'processing') LIMIT 1"
  ).bind(merchantId).first();

  if (pendingPayout) {
    return c.json(err("You already have a pending payout request"), 400);
  }

  const payoutRequestId = `pr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const txnId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create payout request + debit the balance + log transaction (in sequence)
  await c.env.DB.prepare(
    "INSERT INTO payout_requests (id, merchant_id, payout_account_id, amount, status) VALUES (?, ?, ?, ?, 'pending')"
  ).bind(payoutRequestId, merchantId, payoutAccount.id, amount).run();

  await c.env.DB.prepare(
    "UPDATE merchants SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(amount, merchantId).run();

  await c.env.DB.prepare(
    "INSERT INTO balance_transactions (id, merchant_id, amount, type, status, reference_id, description) VALUES (?, ?, ?, 'payout', 'pending', ?, ?)"
  ).bind(txnId, merchantId, -amount, payoutRequestId, `Payout request for $${(amount / 100).toFixed(2)}`).run();

  return c.json(
    ok({
      payout_request_id: payoutRequestId,
      amount,
      status: "pending",
      message: `Payout of $${(amount / 100).toFixed(2)} requested. Processing typically takes 2-5 business days.`,
    }),
    201
  );
});

// ─── GET /merchant/payouts ───────────────────────────────────────────────────

/**
 * List the merchant's payout requests.
 */
merchantPayouts.get("/", async (c) => {
  const merchantId = c.get("merchantId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM payout_requests WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).bind(merchantId, limit, offset).all();

  return c.json(ok({ payouts: results ?? [], limit, offset }));
});
