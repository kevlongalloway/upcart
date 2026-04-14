-- Migration: 0004_create_setup
-- Creates tables for self-serve store setup/onboarding and admin account management.
-- Enables first-run configuration via UI without requiring manual wrangler secret management.

-- Key/value store for store-level configuration set during onboarding.
-- Well-known keys: store_name, store_description, currency, country,
--                  stripe_publishable_key, db_jwt_secret, setup_complete
CREATE TABLE IF NOT EXISTS store_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin accounts created through the onboarding wizard.
-- The login route checks this table first; falls back to ADMIN_USERNAME/ADMIN_PASSWORD
-- env vars for deployments that set secrets via wrangler.
-- password_hash format: "<salt_hex>:<pbkdf2_sha256_hex>" (100,000 iterations)
CREATE TABLE IF NOT EXISTS admin_accounts (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
