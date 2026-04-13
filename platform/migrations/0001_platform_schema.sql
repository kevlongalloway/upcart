-- ─── Platform Users ──────────────────────────────────────────────────────────
-- One account per store owner. Email is the login identifier.
CREATE TABLE IF NOT EXISTS platform_users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,   -- PBKDF2-SHA256, format: "saltB64:hashB64"
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ─── Plans ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,  -- "trial" | "basic" | "pro"
  name            TEXT NOT NULL,
  price_cents     INTEGER NOT NULL DEFAULT 0,
  stripe_price_id TEXT,              -- NULL until Stripe is configured
  features        TEXT NOT NULL DEFAULT '{}', -- JSON object
  sort_order      INTEGER DEFAULT 0,
  active          INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL
);

-- ─── Stores ───────────────────────────────────────────────────────────────────
-- One store per platform user (for now; multi-store per account is a future TODO).
CREATE TABLE IF NOT EXISTS stores (
  id                              TEXT PRIMARY KEY,
  platform_user_id                TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  subdomain                       TEXT UNIQUE NOT NULL,    -- "mystore" → mystore.yourdomain.com
  store_name                      TEXT NOT NULL,
  store_email                     TEXT,

  -- Custom domain
  custom_domain                   TEXT UNIQUE,             -- e.g. "shop.mystore.com"
  custom_domain_verified          INTEGER DEFAULT 0,
  custom_domain_verified_at       TEXT,

  -- Subscription
  plan_id                         TEXT NOT NULL DEFAULT 'trial' REFERENCES plans(id),
  trial_ends_at                   TEXT NOT NULL,
  stripe_customer_id              TEXT UNIQUE,
  stripe_subscription_id          TEXT UNIQUE,
  subscription_status             TEXT DEFAULT 'trialing', -- trialing|active|past_due|canceled|paused|incomplete
  subscription_current_period_end TEXT,

  -- Status
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stores_subdomain        ON stores(subdomain);
CREATE INDEX IF NOT EXISTS idx_stores_custom_domain    ON stores(custom_domain);
CREATE INDEX IF NOT EXISTS idx_stores_platform_user_id ON stores(platform_user_id);
CREATE INDEX IF NOT EXISTS idx_stores_stripe_customer  ON stores(stripe_customer_id);

-- ─── Seed Plans ───────────────────────────────────────────────────────────────
-- stripe_price_id is NULL; update after creating Stripe products (see SAAS_TODO.md Phase 2).
INSERT OR IGNORE INTO plans (id, name, price_cents, stripe_price_id, features, sort_order, active, created_at) VALUES
  (
    'trial',
    'Free Trial',
    0,
    NULL,
    '{"products":50,"orders_per_month":100,"custom_domain":false,"analytics":false,"shipping_labels":false,"trial_days":30}',
    0, 1,
    datetime('now')
  ),
  (
    'basic',
    'Basic',
    1999,
    NULL,
    '{"products":500,"orders_per_month":1000,"custom_domain":true,"analytics":false,"shipping_labels":true,"priority_support":false}',
    1, 1,
    datetime('now')
  ),
  (
    'pro',
    'Pro',
    4999,
    NULL,
    '{"products":-1,"orders_per_month":-1,"custom_domain":true,"analytics":true,"shipping_labels":true,"priority_support":true}',
    2, 1,
    datetime('now')
  );
