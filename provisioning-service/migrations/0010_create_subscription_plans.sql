-- Migration: 0010_create_subscription_plans
-- Admin-managed catalogue of subscription plans, each one bound to a
-- Stripe Price ID. Lets the platform offer multiple plan tiers and lets
-- superadmins add/edit them from the admin portal without redeploying.
--
-- Lookup priority for the provisioning flow (and the admin-service when
-- changing a tenant's plan):
--   1. subscription_plans row whose `key` matches the tenant's plan column.
--   2. The legacy STRIPE_PRICE_ID env var (kept as a fallback so existing
--      tenants keep working until the catalogue is populated).
--
-- The `key` matches the `plan` column on the tenants/subscriptions tables
-- (starter | pro | business + future custom keys).

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                  TEXT PRIMARY KEY,
  key                 TEXT UNIQUE NOT NULL,         -- "starter", "pro", ...
  display_name        TEXT NOT NULL,
  description         TEXT,

  -- Stripe wiring. The price ID is the source of truth — amount/currency/
  -- interval are denormalised from Stripe for display in the admin portal
  -- (Stripe is still authoritative for billing).
  stripe_price_id     TEXT NOT NULL,
  stripe_product_id   TEXT,
  amount_cents        INTEGER NOT NULL DEFAULT 0,   -- e.g. 2900 for $29.00
  currency            TEXT NOT NULL DEFAULT 'usd',
  interval            TEXT NOT NULL DEFAULT 'month',-- "day" | "week" | "month" | "year"
  interval_count      INTEGER NOT NULL DEFAULT 1,

  -- Lifecycle / display
  active              INTEGER NOT NULL DEFAULT 1,   -- 0 → hidden from signup
  is_default          INTEGER NOT NULL DEFAULT 0,   -- 1 → preselected at signup
  trial_days          INTEGER NOT NULL DEFAULT 0,   -- platform-default trial length
  sort_order          INTEGER NOT NULL DEFAULT 0,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_key
  ON subscription_plans (key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price
  ON subscription_plans (stripe_price_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active
  ON subscription_plans (active, sort_order);
