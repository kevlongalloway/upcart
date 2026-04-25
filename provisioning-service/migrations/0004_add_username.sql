-- Migration: 0004_add_username
-- Store the admin username chosen at signup so the central dashboard
-- (dashboard.upcart.online) can resolve email -> username when proxying
-- login requests to the per-tenant store worker's /admin/login endpoint.
--
-- Nullable for backwards compatibility with rows created before this
-- column existed; the central /auth/login endpoint rejects logins for
-- tenants missing a username and falls back to a generic error message.

ALTER TABLE tenants ADD COLUMN username TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_username ON tenants (username);
