-- subscriptions: one row per tenant, created after provisioning completes.
-- Tracks the Stripe subscription, trial window, payment health, and which
-- trial-expiry reminder emails have been sent.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     TEXT    PRIMARY KEY,
  tenant_id              TEXT    NOT NULL UNIQUE REFERENCES tenants(id),
  plan                   TEXT    NOT NULL DEFAULT 'starter',
  -- trialing | active | payment_failed | suspended | cancelled
  status                 TEXT    NOT NULL DEFAULT 'trialing',
  trial_ends_at          TEXT    NOT NULL,     -- ISO 8601; signup + 90 days
  current_period_end     TEXT,                 -- updated from Stripe webhooks
  stripe_subscription_id TEXT,
  stripe_customer_id     TEXT,
  -- Payment failure tracking
  payment_failed_at      TEXT,                 -- timestamp of first failure in current cycle
  payment_failed_count   INTEGER NOT NULL DEFAULT 0,
  -- Trial-expiry reminder flags (0 = not sent, 1 = sent)
  reminder_30d_sent      INTEGER NOT NULL DEFAULT 0,
  reminder_7d_sent       INTEGER NOT NULL DEFAULT 0,
  reminder_1d_sent       INTEGER NOT NULL DEFAULT 0,
  expired_notice_sent    INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_trial_ends
  ON subscriptions (trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_sub_stripe_customer
  ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_sub_stripe_subscription
  ON subscriptions (stripe_subscription_id);
