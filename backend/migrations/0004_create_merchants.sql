-- Migration: Create merchants, merchant_payouts, and balance_transactions tables
-- These tables support merchant authentication (Phase 2) and balance/payout management (Phase 3).

-- ── Merchants ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merchants (
  id             TEXT PRIMARY KEY,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  business_name  TEXT NOT NULL,
  business_category TEXT,
  store_slug     TEXT UNIQUE,
  balance        INTEGER NOT NULL DEFAULT 0,   -- in cents, starts at $0
  active         INTEGER NOT NULL DEFAULT 1,   -- 0 = suspended, 1 = active
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merchants_email      ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_store_slug  ON merchants(store_slug);
CREATE INDEX IF NOT EXISTS idx_merchants_active      ON merchants(active);

-- ── Merchant Payout Accounts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merchant_payouts (
  id                       TEXT PRIMARY KEY,
  merchant_id              TEXT NOT NULL,
  bank_name                TEXT NOT NULL,
  account_holder           TEXT NOT NULL,
  account_number_last4     TEXT NOT NULL,       -- only store last 4 digits
  routing_number_last4     TEXT NOT NULL,       -- only store last 4 digits
  is_default               INTEGER NOT NULL DEFAULT 1,
  verified                 INTEGER NOT NULL DEFAULT 0,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_payouts_merchant ON merchant_payouts(merchant_id);

-- ── Balance Transactions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS balance_transactions (
  id                TEXT PRIMARY KEY,
  merchant_id       TEXT NOT NULL,
  amount            INTEGER NOT NULL,           -- in cents (positive = credit, negative = debit)
  type              TEXT NOT NULL,              -- 'sale', 'payout', 'refund', 'fee', 'adjustment'
  status            TEXT NOT NULL DEFAULT 'completed', -- 'pending', 'completed', 'failed'
  reference_id      TEXT,                       -- order_id, payout_id, etc.
  description       TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_balance_txn_merchant   ON balance_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_balance_txn_type       ON balance_transactions(type);
CREATE INDEX IF NOT EXISTS idx_balance_txn_created    ON balance_transactions(created_at DESC);

-- ── Payout Requests ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payout_requests (
  id                TEXT PRIMARY KEY,
  merchant_id       TEXT NOT NULL,
  payout_account_id TEXT NOT NULL,
  amount            INTEGER NOT NULL,           -- in cents
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  notes             TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  FOREIGN KEY (payout_account_id) REFERENCES merchant_payouts(id)
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_merchant ON payout_requests(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status   ON payout_requests(status);
