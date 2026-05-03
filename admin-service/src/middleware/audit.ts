// Lightweight helper that route handlers call after a successful mutation
// to drop a row in the audit_log table. We don't wrap handlers with a
// post-hook middleware because (a) Hono doesn't expose a clean "after-200"
// hook and (b) handlers know which fields are interesting to record and
// which to redact (passwords).

import type { Context } from "hono";
import type { Bindings, AuthedVariables } from "../types.js";
import { AuditDB } from "../db/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export async function audit(
  c: Context<Env>,
  entry: {
    action: string;
    resource_type: string;
    resource_id: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const user = c.get("user");
  const db   = new AuditDB(c.env.DB);

  // Best-effort: a failed audit write must not roll back the user-facing
  // operation that just succeeded. Log + swallow.
  try {
    await db.write({
      actor_user_id: user?.id    ?? null,
      actor_email:   user?.email ?? null,
      action:        entry.action,
      resource_type: entry.resource_type,
      resource_id:   entry.resource_id,
      metadata:      entry.metadata,
      ip:            c.req.header("CF-Connecting-IP") ?? null,
      user_agent:    c.req.header("User-Agent")       ?? null,
    });
  } catch (e) {
    console.error("audit.write failed:", (e as Error).message, entry);
  }
}
