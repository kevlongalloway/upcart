import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";

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
