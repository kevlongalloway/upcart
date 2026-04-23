import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";
import { finalizeTenant } from "../finalize.js";

export const statusRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /provision/:tenant_id/status
 *
 * Returns the current provisioning status for a tenant.
 * Called by the landing page to poll for completion.
 *
 * Public — no auth required. The tenant_id is a UUID and acts as a
 * capability token: knowledge of it implies the user just signed up.
 */
statusRouter.get("/:tenant_id/status", async (c) => {
  const tenantId = c.req.param("tenant_id");

  if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId)) {
    return c.json(err("Invalid tenant ID."), 400);
  }

  const tenantDB = new TenantDB(c.env.DB);
  const tenant   = await tenantDB.getTenant(tenantId);

  if (!tenant) {
    return c.json(err("Tenant not found."), 404);
  }

  return c.json(
    ok({
      tenant_id:     tenant.id,
      status:        tenant.status,
      subdomain:     tenant.subdomain,
      store_url:     tenant.store_url,
      admin_url:     tenant.admin_url,
      error_message: tenant.status === "failed" ? tenant.error_message : null,
    })
  );
});

/**
 * POST /provision/:tenant_id/recheck
 *
 * Runs the finalization routine (probe /health, run /setup, seed, flip
 * active) on demand for a single tenant. Called by the dashboard's
 * "Refresh status" button so merchants don't have to wait for the
 * cron tick (up to 15 min in dev).
 *
 * Idempotent: safe to call repeatedly. No-ops on tenants not in
 * "finalizing". Public like /status — the tenant_id UUID is the
 * capability token.
 */
statusRouter.post("/:tenant_id/recheck", async (c) => {
  const tenantId = c.req.param("tenant_id");

  if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId)) {
    return c.json(err("Invalid tenant ID."), 400);
  }

  const tenantDB = new TenantDB(c.env.DB);
  const tenant   = await tenantDB.getTenant(tenantId);
  if (!tenant) return c.json(err("Tenant not found."), 404);

  // If the tenant isn't in "finalizing", just return its current state.
  // The dashboard will render the next screen accordingly.
  if (tenant.status !== "finalizing") {
    return c.json(ok({
      tenant_id:  tenant.id,
      status:     tenant.status,
      subdomain:  tenant.subdomain,
      store_url:  tenant.store_url,
      admin_url:  tenant.admin_url,
      outcome:    "noop",
    }));
  }

  const result = await finalizeTenant(c.env, tenant, tenantDB);

  // Re-read so the response reflects any updates finalizeTenant made.
  const updated = await tenantDB.getTenant(tenantId);
  return c.json(ok({
    tenant_id:     updated?.id         ?? tenant.id,
    status:        updated?.status     ?? tenant.status,
    subdomain:     updated?.subdomain  ?? tenant.subdomain,
    store_url:     updated?.store_url  ?? tenant.store_url,
    admin_url:     updated?.admin_url  ?? tenant.admin_url,
    error_message: updated?.status === "failed" ? updated.error_message : null,
    outcome:       result.outcome,
    reason:        "reason" in result ? result.reason : null,
  }));
});
