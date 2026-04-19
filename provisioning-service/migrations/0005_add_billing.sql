-- 0005_add_billing.sql
-- Adds per-tenant Stripe subscription tracking and a global key/value store
-- used to cache platform-level Stripe resource IDs (product, price) that are
-- created lazily on the first signup so deploys require zero Stripe dashboard
-- clicks.

ALTER TABLE tenants ADD COLUMN stripe_customer_id       TEXT;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id   TEXT;
ALTER TABLE tenants ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE tenants ADD COLUMN trial_ends_at            TEXT;
ALTER TABLE tenants ADD COLUMN subscription_status      TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription
  ON tenants(stripe_subscription_id);

-- Global platform-level cache.
-- Keys we use:
--   "stripe_product_id" — auto-created Stripe Product for the subscription plan
--   "stripe_price_id"   — auto-created recurring Price for that product
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
