import { Hono } from "hono";
import Stripe from "stripe";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

const connect = new Hono<{ Bindings: Bindings }>();

function getStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-02-24.acacia",
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getStoreSetting(
  db: D1Database,
  key: string
): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT value FROM store_settings WHERE key = ?1")
      .bind(key)
      .first<{ value: string }>();
    return row?.value || null;
  } catch {
    return null;
  }
}

async function setStoreSetting(
  db: D1Database,
  tenantId: string,
  key: string,
  value: string
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at)
       VALUES (?1, ?2, ?3, datetime('now'))`
    )
    .bind(key, value, tenantId)
    .run();
}

// ─── POST /connect/onboard ──────────────────────────────────────────────────
/**
 * Initiates Stripe Connect onboarding. Creates an Express account if one does
 * not already exist for this tenant, stores the account ID, and returns an
 * Account Link URL the merchant can use to complete onboarding.
 *
 * Body: { return_url: string, refresh_url: string }
 */
connect.post("/onboard", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  let body: { return_url?: string; refresh_url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(err("Invalid JSON body"), 400);
  }

  const { return_url, refresh_url } = body;
  if (typeof return_url !== "string" || typeof refresh_url !== "string") {
    return c.json(err("Body must include `return_url` and `refresh_url` strings"), 400);
  }

  try {
    let accountId = await getStoreSetting(db, "stripe_connect_account_id");

    if (!accountId) {
      // Retrieve store info for pre-filling the Connect onboarding form.
      const storeName = await getStoreSetting(db, "store_name");
      const country = await getStoreSetting(db, "country");

      const acct = await stripe.accounts.create({
        type: "express",
        country: country?.toUpperCase() || undefined,
        business_profile: {
          name: storeName || undefined,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = acct.id;
      await setStoreSetting(db, tenantId, "stripe_connect_account_id", accountId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return c.json(ok({ url: accountLink.url, account_id: accountId }));
  } catch (e) {
    console.error("POST /connect/onboard error:", e);
    if (e instanceof Stripe.errors.StripeError) {
      return c.json(err(`Stripe error: ${e.message}`), 502);
    }
    return c.json(err("Failed to initiate Connect onboarding"), 500);
  }
});

// ─── GET /connect/status ────────────────────────────────────────────────────
/**
 * Returns the current Connect onboarding status for the tenant.
 */
connect.get("/status", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  try {
    const accountId = await getStoreSetting(db, "stripe_connect_account_id");

    if (!accountId) {
      return c.json(ok({ connected: false }));
    }

    const account = await stripe.accounts.retrieve(accountId);

    return c.json(
      ok({
        connected: true,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        account_id: account.id,
      })
    );
  } catch (e) {
    console.error("GET /connect/status error:", e);
    if (e instanceof Stripe.errors.StripeError) {
      return c.json(err(`Stripe error: ${e.message}`), 502);
    }
    return c.json(err("Failed to retrieve Connect status"), 500);
  }
});

// ─── GET /connect/balance ───────────────────────────────────────────────────
/**
 * Returns the merchant's internal balance (available + pending) and recent
 * balance transactions.
 */
connect.get("/balance", async (c) => {
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  try {
    const balance = await db
      .prepare("SELECT * FROM merchant_balances WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{
        available_balance: number;
        pending_balance: number;
        currency: string;
      }>();

    const transactions = await db
      .prepare(
        "SELECT * FROM balance_transactions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20"
      )
      .bind(tenantId)
      .all();

    return c.json(
      ok({
        available_balance: balance?.available_balance ?? 0,
        pending_balance: balance?.pending_balance ?? 0,
        currency: balance?.currency ?? "usd",
        recent_transactions: transactions.results ?? [],
      })
    );
  } catch (e) {
    console.error("GET /connect/balance error:", e);
    return c.json(err("Failed to retrieve balance"), 500);
  }
});

// ─── POST /connect/withdraw ─────────────────────────────────────────────────
/**
 * Requests a withdrawal from the merchant's available balance.
 *
 * Body: { amount: number } (in cents)
 */
connect.post("/withdraw", async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  let body: { amount?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json(err("Invalid JSON body"), 400);
  }

  const { amount } = body;
  if (typeof amount !== "number" || amount <= 0) {
    return c.json(err("Amount must be a positive integer (in cents)"), 400);
  }

  try {
    // Verify sufficient balance
    const balance = await db
      .prepare("SELECT available_balance, currency FROM merchant_balances WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{ available_balance: number; currency: string }>();

    const availableBalance = balance?.available_balance ?? 0;
    const currency = balance?.currency ?? "usd";

    if (amount > availableBalance) {
      return c.json(
        err(`Insufficient balance. Available: ${availableBalance}, requested: ${amount}`),
        400
      );
    }

    // Get Connect account ID
    const connectAccountId = await getStoreSetting(db, "stripe_connect_account_id");
    if (!connectAccountId) {
      return c.json(err("No Connect account found. Complete onboarding first."), 400);
    }

    // Create Stripe Transfer to the connected account
    const transfer = await stripe.transfers.create({
      amount,
      currency,
      destination: connectAccountId,
    });

    const withdrawalId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const newAvailable = availableBalance - amount;

    // Record the withdrawal and update balance atomically.
    await db.batch([
      db
        .prepare(
          `INSERT INTO withdrawal_requests (id, tenant_id, amount, currency, status, stripe_payout_id, created_at, completed_at)
           VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?6)`
        )
        .bind(withdrawalId, tenantId, amount, currency, transfer.id, now),
      db
        .prepare(
          `INSERT INTO balance_transactions (id, tenant_id, type, amount, balance_after, stripe_transfer_id, description, created_at)
           VALUES (?1, ?2, 'withdrawal', ?3, ?4, ?5, 'Withdrawal to connected bank account', ?6)`
        )
        .bind(transactionId, tenantId, -amount, newAvailable, transfer.id, now),
      db
        .prepare(
          "UPDATE merchant_balances SET available_balance = ?1, updated_at = ?2 WHERE tenant_id = ?3"
        )
        .bind(newAvailable, now, tenantId),
    ]);

    return c.json(
      ok({
        id: withdrawalId,
        amount,
        currency,
        stripe_transfer_id: transfer.id,
        status: "completed",
        created_at: now,
      })
    );
  } catch (e) {
    console.error("POST /connect/withdraw error:", e);
    if (e instanceof Stripe.errors.StripeError) {
      return c.json(err(`Stripe error: ${e.message}`), 502);
    }
    return c.json(err("Failed to process withdrawal"), 500);
  }
});

// ─── GET /connect/withdrawals ───────────────────────────────────────────────
/**
 * Lists withdrawal history for the tenant.
 */
connect.get("/withdrawals", async (c) => {
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  try {
    const results = await db
      .prepare(
        "SELECT * FROM withdrawal_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50"
      )
      .bind(tenantId)
      .all();

    return c.json(ok(results.results ?? []));
  } catch (e) {
    console.error("GET /connect/withdrawals error:", e);
    return c.json(err("Failed to retrieve withdrawal history"), 500);
  }
});

// ─── GET /connect/auto-withdraw ─────────────────────────────────────────────
/**
 * Returns auto-withdrawal settings for the tenant.
 */
connect.get("/auto-withdraw", async (c) => {
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  try {
    const settings = await db
      .prepare("SELECT * FROM auto_withdrawal_settings WHERE tenant_id = ?")
      .bind(tenantId)
      .first();

    return c.json(
      ok(
        settings ?? {
          enabled: false,
          frequency: "weekly",
          minimum_amount: 0,
        }
      )
    );
  } catch (e) {
    console.error("GET /connect/auto-withdraw error:", e);
    return c.json(err("Failed to retrieve auto-withdrawal settings"), 500);
  }
});

// ─── PUT /connect/auto-withdraw ─────────────────────────────────────────────
/**
 * Updates auto-withdrawal settings for the tenant.
 *
 * Body: { enabled: boolean, frequency?: string, minimum_amount?: number }
 */
connect.put("/auto-withdraw", async (c) => {
  const db = c.env.DB;
  const tenantId = c.env.TENANT_ID;

  let body: { enabled?: boolean; frequency?: string; minimum_amount?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json(err("Invalid JSON body"), 400);
  }

  const { enabled, frequency, minimum_amount } = body;

  if (typeof enabled !== "boolean") {
    return c.json(err("`enabled` must be a boolean"), 400);
  }

  const validFrequencies = ["daily", "weekly", "biweekly", "monthly"] as const;
  if (frequency !== undefined && !validFrequencies.includes(frequency as typeof validFrequencies[number])) {
    return c.json(err(`frequency must be one of: ${validFrequencies.join(", ")}`), 400);
  }

  if (minimum_amount !== undefined && (typeof minimum_amount !== "number" || minimum_amount < 0)) {
    return c.json(err("`minimum_amount` must be a non-negative number (in cents)"), 400);
  }

  try {
    const now = new Date().toISOString();
    const freq = frequency ?? "weekly";
    const minAmount = minimum_amount ?? 0;

    await db
      .prepare(
        `INSERT INTO auto_withdrawal_settings (id, tenant_id, enabled, frequency, minimum_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id) DO UPDATE SET
           enabled = excluded.enabled,
           frequency = excluded.frequency,
           minimum_amount = excluded.minimum_amount,
           updated_at = excluded.updated_at`
      )
      .bind(crypto.randomUUID(), tenantId, enabled ? 1 : 0, freq, minAmount, now, now)
      .run();

    return c.json(
      ok({
        tenant_id: tenantId,
        enabled,
        frequency: freq,
        minimum_amount: minAmount,
        updated_at: now,
      })
    );
  } catch (e) {
    console.error("PUT /connect/auto-withdraw error:", e);
    return c.json(err("Failed to update auto-withdrawal settings"), 500);
  }
});

export { connect };
