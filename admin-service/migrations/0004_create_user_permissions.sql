-- Migration: 0004_create_user_permissions
-- Direct user→permission grants, in addition to permissions inherited
-- through roles. The effective permission set for a user is:
--
--   union( role_permissions via user_roles, user_permissions )
--
-- Use case: granting a single employee one extra capability (e.g.
-- subscriptions.update during an on-call shift) without creating a new
-- role just for that.

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id         TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  permission_id   TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by      TEXT,                            -- admin_users.id of granter
  granted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user
  ON user_permissions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission
  ON user_permissions (permission_id);
