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

  const storeUrl = tenant.store_url ?? `https://${tenant.subdomain}.${env.BASE_DOMAIN}`;

  if (!(await probeHealthy(storeUrl))) {
    return maybeFail(tenantDB, tenant, "Tenant worker /health is not yet healthy");
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

  const setupRes = await fetch(`${storeUrl}/setup`, {
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
    if (token) await seedStarterProduct(storeUrl, token, pd.store.currency);
  }

  await tenantDB.updateStatus(tenant.id, "active");
  await tenantDB.clearProvisioningData(tenant.id);
  return { outcome: "activated" };
}

async function probeHealthy(storeUrl: string): Promise<boolean> {
  try {
    const ping = await fetch(`${storeUrl}/health`, { method: "GET" });
    if (!ping.ok) return false;
    const data = await ping.json().catch(() => ({})) as
      { ok?: boolean; data?: { status?: string } };
    return data.ok === true && data.data?.status === "healthy";
  } catch {
    return false;
  }
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
