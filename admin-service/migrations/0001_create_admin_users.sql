-- Migration: 0001_create_admin_users
-- Admin users for the Upcart superadmin/employee portal.
-- These are NOT tenant merchants — they are platform staff (superadmins,
-- support agents, content moderators, etc.) authorised by the RBAC tables
-- introduced in 0002_create_roles_permissions.

CREATE TABLE IF NOT EXISTS admin_users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,                -- PBKDF2-SHA256 "<salt>:<hash>"
  full_name       TEXT,

  -- active     → can log in
  -- suspended  → temporarily blocked (failed-attempt lockout, leave, etc.)
  -- disabled   → permanently revoked
  status          TEXT NOT NULL DEFAULT 'active',

  last_login_at   TEXT,
  created_by      TEXT,                         -- admin_users.id of creator (NULL for bootstrap)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email    ON admin_users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (lower(username));
CREATE INDEX IF NOT EXISTS        idx_admin_users_status   ON admin_users (status);
