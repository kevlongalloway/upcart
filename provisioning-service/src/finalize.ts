// Tenant finalization — shared by the cron in index.ts and the manual
// "Refresh status" button in the dashboard (POST /provision/:id/recheck).
//
// Each tenant returned by TenantDB.getFinalizingTenants() gets the same
// treatment:
//   1. probe <store_url>/health — skip if not yet healthy
//   2. POST <store_url>/setup with the signup payload stashed in
//      `provisioning_data` plus the tenant's `password_hash`. 409 means
//      setup already ran on a previous tick; treat as success.
//   3. seed a placeholder product with the JWT /setup returned (best-effort)
//   4. flip status → "active" and clear provisioning_data
//   5. if the tenant has been finalizing > 60 minutes with no progress,
//      flip status → "failed" with a timeout reason
//
// Each tenant is processed in its own try/catch so one flaky store can't
// block the rest (important for the cron path).

import type { Bindings, Tenant } from "./types.js";
import { TenantDB } from "./db.js";

type ProvisioningData = {
  store: { name: string; description: string; currency: string; country: string; theme: string };
  admin: { username: string; email: string };
  stripe_publishable_key: string;
};

export type FinalizeOutcome =
  | { outcome: "activated" }
  | { outcome: "still_finalizing"; reason: string; ageMinutes: number }
  | { outcome: "failed"; reason: string }
  | { outcome: "noop"; reason: string };

/**
 * Runs finalization for every tenant currently in "finalizing". Swallows
 * per-tenant errors so one stuck tenant doesn't prevent the others from
 * activating.
 */
export async function finalizePendingTenants(env: Bindings): Promise<void> {
  console.log(`[${new Date().toISOString()}] Running finalizePendingTenants...`);
  const tenantDB   = new TenantDB(env.DB);
  const finalizing = await tenantDB.getFinalizingTenants();

  for (const tenant of finalizing) {
    try {
      const result = await finalizeTenant(env, tenant, tenantDB);
      logOutcome(tenant, result);
    } catch (e) {
      console.error(`Finalize: unexpected error for tenant ${tenant.id} (${tenant.subdomain}):`, e);
    }
  }
}

/**
 * Runs finalization for a single tenant. Returns the outcome so callers
 * (the manual recheck endpoint) can surface it to the dashboard. The
 * tenant's DB row is updated as a side effect on success/fail.
 */
export async function finalizeTenant(
  env: Bindings,
  tenant: Tenant,
  tenantDB: TenantDB = new TenantDB(env.DB),
): Promise<FinalizeOutcome> {
  if (tenant.status !== "finalizing") {
    return { outcome: "noop", reason: `tenant status is ${tenant.status}, not finalizing` };
  }

  const storeUrl    = tenant.store_url ?? `https://${tenant.subdomain}.${env.BASE_DOMAIN}`;
  const internalUrl = internalWorkerUrl(env, tenant) ?? storeUrl;

  const health = await probeHealthy(internalUrl);
  if (!health.healthy) {
    return maybeFail(tenantDB, tenant, health.reason);
  }

  if (!tenant.provisioning_data) {
    // Edge case: provisioning_data was cleared (e.g. an older code path)
    // but status was never flipped. Nothing left to replay — just activate.
    await tenantDB.updateStatus(tenant.id, "active");
    return { outcome: "activated" };
  }

  let pd: ProvisioningData;
  try {
    pd = JSON.parse(tenant.provisioning_data);
  } catch {
    await tenantDB.updateStatus(tenant.id, "failed", "Corrupted provisioning_data");
    return { outcome: "failed", reason: "Corrupted provisioning_data" };
  }

  const setupRes = await fetch(`${internalUrl}/setup`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      store: pd.store,
      admin: {
        username:      pd.admin.username,
        email:         pd.admin.email,
        password_hash: tenant.password_hash,
      },
      stripe_publishable_key: pd.stripe_publishable_key ?? "",
    }),
  });

  // 409 = /setup already ran on a previous tick. Idempotent — still flip active.
  if (!setupRes.ok && setupRes.status !== 409) {
    const body = await setupRes.text().catch(() => "");
    console.error(`Finalize: /setup failed for ${tenant.id} (${setupRes.status}): ${body}`);
    return maybeFail(tenantDB, tenant, `/setup returned ${setupRes.status}`);
  }

  if (setupRes.ok) {
    const body = await setupRes.clone().json().catch(() => null) as
      | { ok?: boolean; data?: { token?: string } } | null;
    const token = body?.ok ? body.data?.token : undefined;
    if (token) await seedStarterProduct(internalUrl, token, pd.store.currency);
  }

  await tenantDB.updateStatus(tenant.id, "active");
  await tenantDB.clearProvisioningData(tenant.id);
  return { outcome: "activated" };
}

// Worker-to-worker fetches inside Cloudflare use internal routing that can
// lag public edge routing for newly-provisioned Custom Domains. The return
// value surfaces the specific failure (HTTP status, parse failure, network
// error) so the recheck endpoint can tell the dashboard what it got back
// rather than just "not yet healthy".
/**
 * Resolve the URL to use for *internal* worker-to-worker calls to the tenant.
 *
 * Custom Domain routing on the same zone intermittently returns HTTP 522 for
 * the first few minutes after binding (Cloudflare's edge hasn't finished
 * wiring the new host to the target Worker yet). The workers.dev routing
 * doesn't go through the zone, so it's reachable as soon as the script is
 * deployed — perfect for our /health + /setup probes.
 *
 * Returns null when CF_WORKERS_SUBDOMAIN isn't configured or the tenant
 * hasn't had a Worker deployed yet; the caller falls back to the Custom
 * Domain URL in that case.
 */
function internalWorkerUrl(env: Bindings, tenant: Tenant): string | null {
  const sub = (env.CF_WORKERS_SUBDOMAIN ?? "").trim();
  if (!sub || !tenant.cf_worker_name) return null;
  return `https://${tenant.cf_worker_name}.${sub}.workers.dev`;
}

async function probeHealthy(storeUrl: string): Promise<{ healthy: boolean; reason: string }> {
  let ping: Response;
  try {
    ping = await fetch(`${storeUrl}/health`, {
      method:   "GET",
      // Force a fresh request — some CF edge caches hold onto 404s from the
      // brief pre-binding window before the Custom Domain was live.
      cf:       { cacheTtl: 0, cacheEverything: false },
      headers:  { "User-Agent": "upcart-provisioning-finalizer/1" },
      redirect: "follow",
    } as RequestInit & { cf?: unknown });
  } catch (e) {
    return { healthy: false, reason: `GET ${storeUrl}/health threw: ${(e as Error).message}` };
  }

  if (!ping.ok) {
    return { healthy: false, reason: `GET ${storeUrl}/health returned HTTP ${ping.status}` };
  }

  const raw = await ping.text().catch(() => "");
  let data: { ok?: boolean; data?: { status?: string } } | null = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return {
      healthy: false,
      reason:  `GET ${storeUrl}/health returned non-JSON body: ${raw.slice(0, 120)}`,
    };
  }

  if (data?.ok === true && data.data?.status === "healthy") {
    return { healthy: true, reason: "ok" };
  }
  return {
    healthy: false,
    reason:  `GET ${storeUrl}/health body not healthy: ${raw.slice(0, 120)}`,
  };
}

async function maybeFail(
  tenantDB: TenantDB,
  tenant: Tenant,
  reason: string,
): Promise<FinalizeOutcome> {
  const ageMinutes = (Date.now() - new Date(tenant.updated_at).getTime()) / 60_000;
  if (ageMinutes > 60) {
    await tenantDB.updateStatus(tenant.id, "failed", reason);
    return { outcome: "failed", reason };
  }
  return { outcome: "still_finalizing", reason, ageMinutes };
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
        price:    1999,
        currency,
        stock:    -1,
        active:   true,
        images:   [],
        metadata: { seeded: true },
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

function logOutcome(tenant: Tenant, result: FinalizeOutcome): void {
  switch (result.outcome) {
    case "activated":
      console.log(`Finalize: activated tenant ${tenant.id} (${tenant.subdomain})`);
      break;
    case "still_finalizing":
      console.log(
        `Finalize: tenant ${tenant.id} (${tenant.subdomain}) still finalizing ` +
        `(${result.ageMinutes.toFixed(1)}m old): ${result.reason}`
      );
      break;
    case "failed":
      console.log(`Finalize: marked tenant ${tenant.id} (${tenant.subdomain}) as failed: ${result.reason}`);
      break;
    case "noop":
      console.log(`Finalize: no-op for tenant ${tenant.id} (${tenant.subdomain}): ${result.reason}`);
      break;
  }
}
