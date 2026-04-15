-- Migration: 0001_create_tenants
-- Tenant registry for the Upcart provisioning service.
-- One row per merchant store — created when someone signs up via the landing page.
--
-- Status lifecycle:
--   provisioning → Cloudflare resources are being created
--   active       → Store is live and accepting orders
--   suspended    → Temporarily disabled (payment failure, abuse, etc.)
--   cancelled    → Account closed; resources may be deprovisioned
--   failed       → Provisioning failed; see error_message

CREATE TABLE IF NOT EXISTS tenants (
  id              TEXT PRIMARY KEY,   -- UUID generated at sign-up time

  -- Store identity
  subdomain       TEXT UNIQUE NOT NULL,    -- e.g. "mystore" → mystore.upcart.online
  store_name      TEXT NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'starter',  -- starter | pro | business

  -- Contact / auth
  email           TEXT NOT NULL,           -- account owner email (unique per plan)
  password_hash   TEXT NOT NULL,           -- PBKDF2-SHA256 "<salt>:<hash>" for platform login

  -- Provisioning status
  status          TEXT NOT NULL DEFAULT 'provisioning',

  -- Cloudflare resource IDs (populated as provisioning progresses)
  cf_worker_name       TEXT,   -- e.g. "upcart-store-<tenant_id>"
  cf_d1_id             TEXT,   -- D1 database UUID
  cf_r2_bucket         TEXT,   -- R2 bucket name

  -- Domain binding — one of the two binding columns will be set.
  -- Custom Domains (preferred): CF manages DNS automatically.
  -- Worker Route (fallback): requires an explicit DNS record.
  cf_dns_record_id     TEXT,   -- Cloudflare DNS record ID (AAAA proxied placeholder)
  cf_custom_domain_id  TEXT,   -- Workers Custom Domain binding ID
  cf_route_id          TEXT,   -- Workers Route ID (fallback only)

  -- Live URLs (set once provisioning completes)
  store_url       TEXT,   -- https://<subdomain>.upcart.online
  admin_url       TEXT,   -- https://<subdomain>.upcart.online/admin  (served by store worker)

  -- Error tracking
  error_message   TEXT,

  -- Timestamps
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants (subdomain);
CREATE INDEX IF NOT EXISTS idx_tenants_email    ON tenants (email);
CREATE INDEX IF NOT EXISTS idx_tenants_status   ON tenants (status);
CREATE INDEX IF NOT EXISTS idx_tenants_created  ON tenants (created_at DESC);
