-- Migration: 0006_create_balance_payouts
-- Adds tables to support Stripe Connect merchant payouts.
--
-- Architecture:
--   The platform manages all payments on behalf of merchants.  Merchants do
--   not provide their own Stripe API keys; instead they connect via Stripe
--   Connect and receive a stripe_connect_account_id (acct_xxx).
--
--   Payment flow:
--     1. Customer pays → funds land in the platform Stripe account.
--     2. Order is created with amount added to the merchant's pending_balance.
--     3. On delivery confirmation the pending amount is released to
--        available_balance (a "release" balance_transaction).
--     4. Merchant requests a withdrawal (or auto-withdrawal fires) which
--        creates a withdrawal_request and triggers a Stripe payout/transfer
--        to their connected account.
--
--   Every balance mutation is recorded as a balance_transaction row so the
--   ledger is fully auditable.

-- ─── Merchant balances ───────────────────────────────────────────────────────
-- One row per tenant.  available_balance is what the merchant can withdraw;
-- pending_balance is held until the corresponding order is delivered.
-- All monetary values are stored in smallest currency unit (cents).

CREATE TABLE IF NOT EXISTS merchant_balances (
  id                TEXT    PRIMARY KEY,
  tenant_id         TEXT    NOT NULL UNIQUE,
  available_balance INTEGER NOT NULL DEFAULT 0,   -- withdrawable (cents)
  pending_balance   INTEGER NOT NULL DEFAULT 0,   -- held until delivery (cents)
  currency          TEXT    NOT NULL DEFAULT 'usd',
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Balance transactions (ledger) ──────────────────────────────────────────
-- Immutable append-only ledger of every balance change.
--
-- type values:
--   sale       — funds added to pending_balance when order is paid
--   release    — funds moved from pending to available on delivery
--   withdrawal — funds debited from available when payout is sent
--   refund     — funds reversed (partial or full order refund)
--   adjustment — manual correction by platform admin
--
-- amount sign convention:
--   positive = credit to available_balance
--   negative = debit from available_balance

CREATE TABLE IF NOT EXISTS balance_transactions (
  id                 TEXT    PRIMARY KEY,
  tenant_id          TEXT    NOT NULL,
  type               TEXT    NOT NULL,               -- sale | release | withdrawal | refund | adjustment
  amount             INTEGER NOT NULL,               -- positive = credit, negative = debit
  balance_after      INTEGER NOT NULL,               -- available_balance after this txn
  order_id           TEXT,                            -- nullable; references orders(id)
  stripe_transfer_id TEXT,                            -- nullable; tr_xxx
  stripe_payout_id   TEXT,                            -- nullable; po_xxx
  description        TEXT    NOT NULL DEFAULT '',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_balance_txn_tenant_created
  ON balance_transactions (tenant_id, created_at DESC);

-- ─── Withdrawal requests ────────────────────────────────────────────────────
-- One row per payout request.  Tracks lifecycle from pending → completed/failed.
--
-- status lifecycle:
--   pending    → merchant submitted request, not yet processed
--   processing → Stripe payout initiated
--   completed  → Stripe confirmed payout succeeded
--   failed     → Stripe reported failure; see failure_reason

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  amount          INTEGER NOT NULL,                  -- payout amount (cents)
  currency        TEXT    NOT NULL DEFAULT 'usd',
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
  stripe_payout_id TEXT,                              -- nullable; po_xxx
  failure_reason  TEXT,                               -- nullable; human-readable error
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT                                -- nullable; set when status → completed/failed
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_tenant_created
  ON withdrawal_requests (tenant_id, created_at DESC);

-- ─── Auto-withdrawal settings ───────────────────────────────────────────────
-- Per-tenant configuration for scheduled automatic withdrawals.
--
-- frequency values:
--   daily    — every day
--   weekly   — every 7 days (default)
--   biweekly — every 14 days
--   monthly  — first of each month
--
-- minimum_amount: auto-withdrawal fires only when available_balance >= this
-- value.  Default is 1000 (= $10.00).

CREATE TABLE IF NOT EXISTS auto_withdrawal_settings (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 0,        -- 0 = off, 1 = on
  frequency       TEXT    NOT NULL DEFAULT 'weekly',  -- daily | weekly | biweekly | monthly
  minimum_amount  INTEGER NOT NULL DEFAULT 1000,     -- cents; default $10.00
  next_run_at     TEXT,                               -- nullable; ISO 8601 datetime
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
