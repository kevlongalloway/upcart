import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";
import { verifyPassword } from "../password.js";

// ─── Central login for the multi-tenant dashboard ─────────────────────────────
//
// dashboard.upcart.online is a single deployment that every merchant logs into.
// To authenticate, the dashboard posts {email, password} here. We look up the
// tenant by email and route to one of three paths depending on its status:
//
//  • status === "active"
//      Proxy {username, password} to <store_url>/admin/login. The tenant
//      worker is the source of truth for admin creds — return the JWT it
//      issues plus the worker URL the dashboard targets thereafter.
//
//  • status === "awaiting_setup"
//      The tenant worker exists but has never had its admin user / store
//      settings populated (POST /provision now defers this to first login).
//      We:
//        1. Validate the supplied password against the provisioning DB's
//           own password_hash.
//        2. Probe <store_url>/health with a short timeout — if the Custom
//           Domain SSL still isn't ready, return 202 so the dashboard
//           shows the "still setting up" panel.
//        3. POST <store_url>/setup with the stored signup config plus the
//           plaintext password the merchant just typed.
//        4. Best-effort seed a starter product.
//        5. Flip status to "active", clear provisioning_data, and return
//           the JWT /setup issued (no second round-trip needed).
//
//  • status === any of {suspended, cancelled, failed, ...}
//      Return the appropriate friendly error.

export const authRouter = new Hono<{ Bindings: Bindings }>();

const loginSchema = z.object({
  email:    z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const HEALTH_PROBE_TIMEOUT_MS = 5_000;

authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const tenantDB = new TenantDB(c.env.DB);

  // Don't leak whether an email exists — every wrong-creds failure returns
  // the same error.
  const generic = () => c.json(err("Invalid email or password."), 401);

  const tenant = await tenantDB.getTenantByEmail(email);
  if (!tenant) return generic();

  // ── Terminal / blocked states ──────────────────────────────────────────
  if (tenant.status === "suspended") return c.json(err("Your store is suspended. Please contact support."), 403);
  if (tenant.status === "cancelled") return c.json(err("This store has been cancelled."), 403);
  if (tenant.status === "failed")    return c.json(err("Your store setup failed. Please sign up again or contact support."), 409);

  // ── Still doing the fast Cloudflare-API setup (D1, R2, Worker, DNS) ─────
  // Tell the dashboard "not ready yet" without trying to validate the
  // password — the tenant worker may not even exist on the edge yet.
  const stillProvisioning = new Set([
    "provisioning",
    "creating_database",
    "creating_storage",
    "deploying_worker",
    "configuring_domain",
    "finalizing",
  ]);
  if (stillProvisioning.has(tenant.status)) {
    return c.json(ok({
      provisioning: true,
      status:       tenant.status,
      tenant_id:    tenant.id,
      subdomain:    tenant.subdomain,
      store_name:   tenant.store_name,
    }), 202);
  }

  // From here on we need a usable store_url regardless of branch.
  if (!tenant.store_url) {
    console.error(`Tenant ${tenant.id} status=${tenant.status} has no store_url; bug in provisioning.`);
    return c.json(err("Your store is misconfigured. Please contact support."), 500);
  }

  // ── First-login bootstrap path ──────────────────────────────────────────
  if (tenant.status === "awaiting_setup") {
    return await firstLoginBootstrap(c, tenantDB, tenant, password);
  }

  // ── Normal active-store login path ─────────────────────────────────────
  if (!tenant.username) return generic();

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

// ─── First-login bootstrap ───────────────────────────────────────────────────

async function firstLoginBootstrap(
  c: Context<{ Bindings: Bindings }>,
  tenantDB: TenantDB,
  tenant: NonNullable<Awaited<ReturnType<TenantDB["getTenantByEmail"]>>>,
  password: string,
): Promise<Response> {
  const generic = () => c.json(err("Invalid email or password."), 401);

  // 1. Verify the password against our own hash. We can't verify against the
  //    tenant worker yet (its admin user doesn't exist) so this is the only
  //    line of defence.
  const valid = await verifyPassword(password, tenant.password_hash);
  if (!valid) return generic();

  if (!tenant.provisioning_data) {
    console.error(`Tenant ${tenant.id} is awaiting_setup but provisioning_data is null.`);
    return c.json(err("Setup data missing. Please contact support."), 500);
  }
  if (!tenant.username) {
    console.error(`Tenant ${tenant.id} is awaiting_setup but username is null.`);
    return c.json(err("Setup data missing. Please contact support."), 500);
  }
  const storeUrl = tenant.store_url!;

  let provisioningData: {
    store: { name: string; description: string; currency: string; country: string; theme: string };
    admin: { username: string; email: string };
    stripe_publishable_key: string;
  };
  try {
    provisioningData = JSON.parse(tenant.provisioning_data);
  } catch {
    console.error(`Tenant ${tenant.id} provisioning_data is not valid JSON.`);
    return c.json(err("Setup data corrupted. Please contact support."), 500);
  }

  // 2. Health probe — bail fast with a 202 if the Custom Domain SSL still
  //    isn't routable. The dashboard already knows how to render this.
  const probe = new AbortController();
  const probeTimer = setTimeout(() => probe.abort(), HEALTH_PROBE_TIMEOUT_MS);
  let reachable = false;
  try {
    const ping = await fetch(`${storeUrl}/health`, { method: "GET", signal: probe.signal });
    reachable = ping.ok;
  } catch {
    reachable = false;
  } finally {
    clearTimeout(probeTimer);
  }
  if (!reachable) {
    return c.json(ok({
      provisioning: true,
      status:       tenant.status,
      tenant_id:    tenant.id,
      subdomain:    tenant.subdomain,
      store_name:   tenant.store_name,
    }), 202);
  }

  // 3. POST /setup with the merchant's password (in memory from this request).
  let setupRes: Response;
  try {
    setupRes = await fetch(`${storeUrl}/setup`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        store: provisioningData.store,
        admin: {
          username: provisioningData.admin.username,
          email:    provisioningData.admin.email,
          password,
        },
        stripe_publishable_key: provisioningData.stripe_publishable_key,
      }),
    });
  } catch (e) {
    console.error(`/setup fetch failed for tenant ${tenant.id}:`, e);
    return c.json(err("Could not reach your store to finish setup. Please try again."), 503);
  }

  if (!setupRes.ok && setupRes.status !== 409) {
    const body = await setupRes.text().catch(() => "");
    console.error(`/setup returned ${setupRes.status} for tenant ${tenant.id}:`, body);
    return c.json(err("Setup failed on your store worker. Please try again."), 502);
  }

  // /setup returns { ok: true, data: { token } } on success. Reuse it as the
  // session token so we don't need a second round-trip.
  let token: string | undefined;
  if (setupRes.ok) {
    const body = await setupRes.json().catch(() => null) as
      | { ok?: boolean; data?: { token?: string } }
      | null;
    token = body?.ok === true ? body.data?.token : undefined;
  }

  // If /setup was skipped (409 already-configured) or didn't return a token,
  // fall back to /admin/login.
  if (!token) {
    try {
      const loginRes = await fetch(`${storeUrl}/admin/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username: tenant.username, password }),
      });
      if (loginRes.ok) {
        const body = await loginRes.json().catch(() => null) as
          | { ok?: boolean; data?: { token?: string } }
          | null;
        token = body?.ok === true ? body.data?.token : undefined;
      }
    } catch (e) {
      console.error(`Fallback /admin/login failed for tenant ${tenant.id}:`, e);
    }
  }

  if (!token) {
    return c.json(err("Setup completed but issuing your session failed. Please try logging in again."), 502);
  }

  // 4. Best-effort seed a starter product so the storefront isn't empty.
  c.executionCtx.waitUntil(
    seedStarterProduct(storeUrl, token, provisioningData.store.currency)
  );

  // 5. Flip status to active and clear the cached signup payload.
  await tenantDB.updateStatus(tenant.id, "active");
  await tenantDB.clearProvisioningData(tenant.id);

  return c.json(ok({
    token,
    tenant_id:  tenant.id,
    subdomain:  tenant.subdomain,
    store_name: tenant.store_name,
    worker_url: storeUrl,
    store_url:  storeUrl,
    admin_url:  `https://dashboard.${c.env.BASE_DOMAIN}`,
  }));
}

async function seedStarterProduct(storeUrl: string, token: string, currency: string): Promise<void> {
  try {
    const res = await fetch(`${storeUrl}/admin/products`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        name:        "Welcome to your store",
        description:
          "This is a placeholder product so your store isn't empty when you " +
          "first share the link. Edit or delete it from your dashboard — then " +
          "add your real products.",
        price:       1999,
        currency,
        stock:       -1,
        active:      true,
        images:      [],
        metadata:    { seeded: true },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`Starter product seed failed (${res.status}): ${body}`);
    }
  } catch (e) {
    console.warn("Starter product seed threw; ignoring:", (e as Error).message);
  }
}

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
