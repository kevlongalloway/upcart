-- Migration: 0003_create_audit_log
-- Append-only audit trail of every privileged mutation through the
-- admin-service. Read by /audit; written by middleware/audit.ts after
-- mutation handlers complete successfully.

CREATE TABLE IF NOT EXISTS audit_log (
  id              TEXT PRIMARY KEY,
  actor_user_id   TEXT,
  actor_email     TEXT,
  action          TEXT NOT NULL,                -- e.g. "role.create", "provision.delete"
  resource_type   TEXT NOT NULL,                -- "role" | "permission" | "user" | "provision"
  resource_id     TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',   -- JSON blob (request body, diff, etc.)
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created  ON audit_log (created_at DESC);
