import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";

// ─── Central login for the multi-tenant dashboard ─────────────────────────────
//
// dashboard.upcart.online is a single deployment that every merchant logs into.
// To authenticate, the dashboard posts {email, password} here. We look up the
// tenant by email, grab its stored `username` + `store_url`, and proxy the
// login to the per-tenant store worker's /admin/login endpoint. On success we
// return the JWT the worker issued plus everything the dashboard needs to
// target that tenant from subsequent requests (worker URL, store name, etc.).
//
// The provisioning DB's own password_hash is NOT used here — the tenant's
// worker is the source of truth for admin credentials. This keeps both copies
// from drifting and means a merchant rotating their password in the dashboard
// only has to touch one place.

export const authRouter = new Hono<{ Bindings: Bindings }>();

const loginSchema = z.object({
  email:    z.string().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const tenantDB = new TenantDB(c.env.DB);

  // Don't leak whether an email exists — every failure returns the same error.
  const generic = () => c.json(err("Invalid email or password."), 401);

  const tenant = await tenantDB.getTenantByEmail(email);
  if (!tenant) return generic();

  // Guard against logins for stores that aren't finished provisioning (or are
  // suspended / cancelled / failed). A generic-but-useful message is fine here
  // because the merchant just signed up and is expecting a specific state.
  if (tenant.status !== "active") {
    if (tenant.status === "suspended")  return c.json(err("Your store is suspended. Please contact support."), 403);
    if (tenant.status === "cancelled")  return c.json(err("This store has been cancelled."), 403);
    if (tenant.status === "failed")     return c.json(err("Your store setup failed. Please sign up again or contact support."), 409);
    // Still provisioning — return 202 with the current state so the dashboard
    // can render an inline "still setting up" panel with a refresh button
    // instead of a hard error. We deliberately don't validate the password
    // yet (the tenant worker isn't reachable to check it) — once the store
    // is active they'll re-submit and authenticate normally.
    return c.json(ok({
      provisioning: true,
      status:       tenant.status,
      tenant_id:    tenant.id,
      subdomain:    tenant.subdomain,
      store_name:   tenant.store_name,
    }), 202);
  }

  if (!tenant.store_url || !tenant.username) return generic();

  // Proxy credentials to the tenant's own worker.
  let loginRes: Response;
  try {
    loginRes = await fetch(`${tenant.store_url}/admin/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username: tenant.username, password }),
    });
  } catch (e) {
    console.error(`Login proxy fetch failed for tenant ${tenant.id}:`, e);
    return c.json(err("Your store is temporarily unreachable. Please try again."), 503);
  }

  if (loginRes.status === 401) return generic();

  if (!loginRes.ok) {
    const body = await loginRes.text().catch(() => "");
    console.error(`Worker /admin/login returned ${loginRes.status} for tenant ${tenant.id}:`, body);
    return c.json(err("Login failed. Please try again."), 502);
  }

  const body = await loginRes.json().catch(() => null) as
    | { ok?: boolean; data?: { token?: string } }
    | null;

  const token = body?.ok === true ? body.data?.token : undefined;
  if (!token) return generic();

  return c.json(ok({
    token,
    tenant_id:  tenant.id,
    subdomain:  tenant.subdomain,
    store_name: tenant.store_name,
    worker_url: tenant.store_url,
    store_url:  tenant.store_url,
    admin_url:  `https://dashboard.${c.env.BASE_DOMAIN}`,
  }));
});

/**
 * GET /auth/context
 *
 * Given a `worker_url` (already known to the dashboard after a successful
 * login), returns safe, public metadata about the tenant. The dashboard can
 * use this to show the store name / subdomain in the sidebar even after a
 * page reload — without shipping all tenant metadata in the login response
 * to the browser's sessionStorage more than necessary.
 *
 * Does not require the JWT — the worker_url itself is a public identifier
 * (it's the storefront URL). We only return fields that are public anyway.
 */
authRouter.get("/context", async (c) => {
  const workerUrl = c.req.query("worker_url")?.toLowerCase().trim();
  if (!workerUrl) return c.json(err("Missing worker_url."), 400);

  const tenant = await c.env.DB
    .prepare("SELECT * FROM tenants WHERE lower(store_url) = ?1 LIMIT 1")
    .bind(workerUrl)
    .first<{
      id: string;
      subdomain: string;
      store_name: string;
      status: string;
      store_url: string | null;
    }>();

  if (!tenant) return c.json(err("Unknown store."), 404);

  return c.json(ok({
    tenant_id:  tenant.id,
    subdomain:  tenant.subdomain,
    store_name: tenant.store_name,
    store_url:  tenant.store_url,
    status:     tenant.status,
  }));
});
