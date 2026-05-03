-- Migration: 0002_create_roles_permissions
-- Flexible role/permission system. The catalogue starts with the system
-- roles + permissions seeded by src/seed.ts; superadmin can extend it from
-- the portal at runtime via /roles and /permissions.
--
-- Authorization model:
--   • Each admin_user has 0..N roles (user_roles).
--   • Each role has 0..N permissions (role_permissions).
--   • The wildcard permission key "*" grants all current and future
--     permissions; the superadmin role holds it.
--   • Permission keys follow "<resource>.<action>" — adding a new
--     management module = inserting new rows here, no schema change.

CREATE TABLE IF NOT EXISTS roles (
  id              TEXT PRIMARY KEY,
  key             TEXT UNIQUE NOT NULL,         -- slug, e.g. "superadmin"
  display_name    TEXT NOT NULL,
  description     TEXT,
  is_system       INTEGER NOT NULL DEFAULT 0,   -- 1 → cannot be deleted/renamed
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_roles_is_system ON roles (is_system);

CREATE TABLE IF NOT EXISTS permissions (
  id              TEXT PRIMARY KEY,
  key             TEXT UNIQUE NOT NULL,         -- e.g. "provisions.delete" or "*"
  display_name    TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,                -- "users" | "roles" | ... (UI grouping)
  is_system       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions (category);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id   TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role       ON role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions (permission_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id         TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role_id         TEXT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  assigned_by     TEXT,                         -- admin_users.id of assigner
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role_id);
