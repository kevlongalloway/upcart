import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

type MerchantVars = { merchantId: string; merchantEmail: string };

export const merchantProfile = new Hono<{
  Bindings: Bindings;
  Variables: MerchantVars;
}>();

/**
 * GET /merchant/me
 * Get the current merchant's profile. Requires merchant JWT.
 */
merchantProfile.get("/", async (c) => {
  const merchantId = c.get("merchantId");

  const merchant = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, email, business_name, business_category,
            store_slug, balance, active, created_at, updated_at
     FROM merchants WHERE id = ?`
  ).bind(merchantId).first<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    business_name: string;
    business_category: string;
    store_slug: string;
    balance: number;
    active: number;
    created_at: string;
    updated_at: string;
  }>();

  if (!merchant) {
    return c.json(err("Merchant not found"), 404);
  }

  // Fetch default payout account if any
  const payout = await c.env.DB.prepare(
    `SELECT id, bank_name, account_holder, account_number_last4, routing_number_last4, is_default, verified
     FROM merchant_payouts WHERE merchant_id = ? AND is_default = 1 LIMIT 1`
  ).bind(merchantId).first<{
    id: string;
    bank_name: string;
    account_holder: string;
    account_number_last4: string;
    routing_number_last4: string;
    is_default: number;
    verified: number;
  }>();

  return c.json(
    ok({
      id: merchant.id,
      first_name: merchant.first_name,
      last_name: merchant.last_name,
      email: merchant.email,
      business_name: merchant.business_name,
      business_category: merchant.business_category,
      store_slug: merchant.store_slug,
      balance: merchant.balance,
      active: merchant.active === 1,
      created_at: merchant.created_at,
      updated_at: merchant.updated_at,
      payout_account: payout
        ? {
            id: payout.id,
            bank_name: payout.bank_name,
            account_holder: payout.account_holder,
            account_last4: payout.account_number_last4,
            routing_last4: payout.routing_number_last4,
            verified: payout.verified === 1,
          }
        : null,
    })
  );
});
