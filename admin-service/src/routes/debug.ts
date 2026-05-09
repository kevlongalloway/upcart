// /debug — superadmin-only system check + on-demand seed re-run.
// Same shape as provisioning-service/src/routes/debug.ts so operators have
// one mental model across services.

import { Hono } from "hono";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { seedSystemRolesAndPermissions } from "../seed.js";
import { requirePermissions } from "../middleware/permissions.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const debugRouter = new Hono<Env>();

function redact(v: string | undefined, hint = 6) {
  if (!v) return { set: false };
  return { set: true, length: v.length, hint: v.slice(0, hint) + "..." };
}

// "*" gates this to superadmin only.
debugRouter.get("/", requirePermissions("*"), async (c) => {
  const out: Record<string, unknown> = {};

  out.config = {
    BASE_DOMAIN:          redact(c.env.BASE_DOMAIN, 99),
    WORKER_SCRIPT_PREFIX: redact(c.env.WORKER_SCRIPT_PREFIX, 99),
    WORKER_BUNDLE_KEY:    redact(c.env.WORKER_BUNDLE_KEY, 99),
    CF_WORKERS_SUBDOMAIN: redact(c.env.CF_WORKERS_SUBDOMAIN, 99),
    CF_ACCOUNT_ID:        redact(c.env.CF_ACCOUNT_ID),
    CF_API_TOKEN:         redact(c.env.CF_API_TOKEN),
    CF_ZONE_ID:           redact(c.env.CF_ZONE_ID),
    JWT_SECRET:           redact(c.env.JWT_SECRET),
  };

  const missingSecrets = (
    ["CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_ZONE_ID", "JWT_SECRET"] as const
  ).filter(k => !c.env[k]);
  out.missing_secrets = missingSecrets;
  out.secrets_ok      = missingSecrets.length === 0;

  // ── DB connectivity (admin DB) ───────────────────────────────────────────
  try {
    const db = new AdminDB(c.env);
    const userCount = await db.users.countActive();
    const roles     = await db.roles.list();
    out.admin_db = { ok: true, users: userCount, roles: roles.length };
  } catch (e) {
    out.admin_db = { ok: false, error: (e as Error).message };
  }

  // ── DB connectivity (provisioning DB) ────────────────────────────────────
  try {
    const row = await c.env.PROVISIONING_DB
      .prepare("SELECT COUNT(*) AS n FROM tenants")
      .first<{ n: number }>();
    out.provisioning_db = { ok: true, tenants: row?.n ?? 0 };
  } catch (e) {
    out.provisioning_db = { ok: false, error: (e as Error).message };
  }

  // ── R2 bundle ────────────────────────────────────────────────────────────
  try {
    const obj = await c.env.WORKER_BUNDLES.get(c.env.WORKER_BUNDLE_KEY);
    out.bundle = obj
      ? { ok: true, size_bytes: obj.size, etag: obj.etag }
      : { ok: false, error: `Key "${c.env.WORKER_BUNDLE_KEY}" not in WORKER_BUNDLES` };
  } catch (e) {
    out.bundle = { ok: false, error: (e as Error).message };
  }

  return c.json(ok(out));
});

// ─── POST /debug/seed ─────────────────────────────────────────────────────────
//
// Re-runs the system-role/permission seeder. Idempotent. Useful after
// extending SYSTEM_PERMISSIONS in seed.ts and re-deploying — a single call
// here picks up the new keys without re-deploying again.

debugRouter.post("/seed", requirePermissions("*"), async (c) => {
  try {
    await seedSystemRolesAndPermissions(c.env.DB);
    return c.json(ok({ seeded: true }));
  } catch (e) {
    return c.json(err("Seed failed", { message: (e as Error).message }), 500);
  }
});
