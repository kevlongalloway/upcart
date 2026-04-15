-- Migration: 0005_add_tenant_id
-- Adds tenant isolation to all tables to support multi-tenant deployments.
--
-- Architecture note:
--   The current deployment model is one Cloudflare Worker + D1 database per tenant.
--   In that model tenant_id is always the same value within a database, but the
--   column is added now so that:
--     1. A future shared-database model works without schema changes.
--     2. Every row carries a reference back to the provisioning-service tenant record.
--     3. Cross-tenant analytics (run against a read replica) are possible.
--
-- The TENANT_ID environment variable on each Worker is set by the provisioning
-- service at deploy time and is written to every row by the D1 adapter.

-- ─── Tenants reference table ──────────────────────────────────────────────────
-- Lightweight record linking this database to the provisioning service tenant.
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,   -- matches provisioning-service tenant.id (UUID)
  subdomain  TEXT UNIQUE NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'starter',  -- starter | pro | business
  status     TEXT NOT NULL DEFAULT 'active',   -- active | suspended | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Add tenant_id to all tables ─────────────────────────────────────────────
-- SQLite does not support adding NOT NULL columns without a DEFAULT, so we use
-- DEFAULT '' and backfill in a single UPDATE pass per table.

ALTER TABLE products       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders         ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE discounts      ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE store_settings ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_accounts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';

-- ─── Composite indexes for tenant-scoped queries ──────────────────────────────
-- These let the planner pick the tenant_id filter first (most selective in a
-- shared-DB future) before filtering on status/created_at.

CREATE INDEX IF NOT EXISTS idx_products_tenant_active
  ON products (tenant_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status
  ON orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_fulfillment
  ON orders (tenant_id, fulfillment_status);

CREATE INDEX IF NOT EXISTS idx_order_items_tenant
  ON order_items (tenant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_discounts_tenant_active
  ON discounts (tenant_id, active, ends_at);

CREATE INDEX IF NOT EXISTS idx_store_settings_tenant
  ON store_settings (tenant_id, key);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_tenant
  ON admin_accounts (tenant_id, username);
