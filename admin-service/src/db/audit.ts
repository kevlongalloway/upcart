// Append-only audit log writer + reader for the admin-service.
// Every mutating route should call AuditDB.write() after a successful change;
// the helper in middleware/audit.ts wraps that boilerplate.

import { randomUUID } from "crypto";
import type { AuditLogEntry } from "../types.js";

type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    // corrupt JSON — surface raw text instead of throwing on read.
    metadata = { _raw: row.metadata };
  }
  return {
    id:            row.id,
    actor_user_id: row.actor_user_id,
    actor_email:   row.actor_email,
    action:        row.action,
    resource_type: row.resource_type,
    resource_id:   row.resource_id,
    metadata,
    ip:            row.ip,
    user_agent:    row.user_agent,
    created_at:    row.created_at,
  };
}

export class AuditDB {
  constructor(private readonly db: D1Database) {}

  async write(entry: {
    actor_user_id: string | null;
    actor_email: string | null;
    action: string;
    resource_type: string;
    resource_id: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
    user_agent?: string | null;
  }): Promise<void> {
    const id  = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO audit_log
           (id, actor_user_id, actor_email, action, resource_type, resource_id,
            metadata, ip, user_agent, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
      .bind(
        id,
        entry.actor_user_id,
        entry.actor_email,
        entry.action,
        entry.resource_type,
        entry.resource_id,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
        entry.user_agent ?? null,
        now,
      )
      .run();
  }

  async list(opts: {
    limit: number;
    offset: number;
    actor_user_id?: string;
    resource_type?: string;
    resource_id?: string;
  }): Promise<AuditLogEntry[]> {
    const where: string[] = [];
    const vals: unknown[] = [];

    if (opts.actor_user_id) {
      where.push(`actor_user_id = ?${vals.length + 1}`);
      vals.push(opts.actor_user_id);
    }
    if (opts.resource_type) {
      where.push(`resource_type = ?${vals.length + 1}`);
      vals.push(opts.resource_type);
    }
    if (opts.resource_id) {
      where.push(`resource_id = ?${vals.length + 1}`);
      vals.push(opts.resource_id);
    }

    const sql =
      `SELECT * FROM audit_log
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT ?${vals.length + 1} OFFSET ?${vals.length + 2}`;

    vals.push(opts.limit, opts.offset);

    const rows = await this.db.prepare(sql).bind(...vals).all<AuditLogRow>();
    return (rows.results ?? []).map(rowToEntry);
  }
}
