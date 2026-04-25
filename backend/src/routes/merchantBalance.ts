import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

type MerchantVars = { merchantId: string; merchantEmail: string };

export const merchantBalance = new Hono<{
  Bindings: Bindings;
  Variables: MerchantVars;
}>();

// ─── GET /merchant/balance ───────────────────────────────────────────────────

/**
 * Returns the merchant's current balance and a summary of recent activity.
 */
merchantBalance.get("/", async (c) => {
  const merchantId = c.get("merchantId");

  const merchant = await c.env.DB.prepare(
    "SELECT balance FROM merchants WHERE id = ?"
  ).bind(merchantId).first<{ balance: number }>();

  if (!merchant) {
    return c.json(err("Merchant not found"), 404);
  }

  // Aggregate lifetime totals
  const totals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'sale'   AND status = 'completed' THEN amount ELSE 0 END), 0) as total_sales,
       COALESCE(SUM(CASE WHEN type = 'payout'  AND status = 'completed' THEN ABS(amount) ELSE 0 END), 0) as total_payouts,
       COALESCE(SUM(CASE WHEN type = 'refund'  AND status = 'completed' THEN ABS(amount) ELSE 0 END), 0) as total_refunds,
       COALESCE(SUM(CASE WHEN type = 'fee'     AND status = 'completed' THEN ABS(amount) ELSE 0 END), 0) as total_fees
     FROM balance_transactions WHERE merchant_id = ?`
  ).bind(merchantId).first<{
    total_sales: number;
    total_payouts: number;
    total_refunds: number;
    total_fees: number;
  }>();

  // Pending payout total
  const pendingPayout = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as pending FROM payout_requests WHERE merchant_id = ? AND status IN ('pending', 'processing')"
  ).bind(merchantId).first<{ pending: number }>();

  return c.json(
    ok({
      balance: merchant.balance,
      pending_payout: pendingPayout?.pending ?? 0,
      lifetime: {
        total_sales: totals?.total_sales ?? 0,
        total_payouts: totals?.total_payouts ?? 0,
        total_refunds: totals?.total_refunds ?? 0,
        total_fees: totals?.total_fees ?? 0,
      },
    })
  );
});

// ─── GET /merchant/balance/transactions ──────────────────────────────────────

/**
 * Returns paginated transaction history for the merchant.
 */
merchantBalance.get("/transactions", async (c) => {
  const merchantId = c.get("merchantId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const type = c.req.query("type"); // optional filter: sale, payout, refund, fee

  let query = "SELECT * FROM balance_transactions WHERE merchant_id = ?";
  const params: any[] = [merchantId];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  return c.json(ok({ transactions: results ?? [], limit, offset }));
});
