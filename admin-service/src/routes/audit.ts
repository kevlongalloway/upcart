// /audit — read-only access to the append-only audit log.

import { Hono } from "hono";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok } from "../types.js";
import { AdminDB } from "../db/index.js";
import { requirePermissions } from "../middleware/permissions.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const auditRouter = new Hono<Env>();

auditRouter.get("/", requirePermissions("audit.read"), async (c) => {
  const limit  = Math.min(Math.max(1, parseInt(c.req.query("limit")  ?? "50", 10) || 50), 500);
  const offset = Math.max(0,            parseInt(c.req.query("offset") ?? "0",  10) || 0);

  const db = new AdminDB(c.env);
  const items = await db.audit.list({
    limit, offset,
    actor_user_id: c.req.query("actor_user_id") || undefined,
    resource_type: c.req.query("resource_type") || undefined,
    resource_id:   c.req.query("resource_id")   || undefined,
  });
  return c.json(ok({ items, limit, offset }));
});
