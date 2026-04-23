// TODO PRODUCTION: tighten the cron cadence in wrangler.toml from "*/15 * * * *"
// to "*/3 * * * *" so tenants flip from "finalizing" to "active" within a few
// minutes of signup instead of up to 15.
import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import type { Bindings } from "./types.js";
import { provisionRouter } from "./routes/provision.js";
import { statusRouter } from "./routes/status.js";
import { authRouter } from "./routes/auth.js";
import { TenantDB } from "./db.js";

const app = new Hono<{ Bindings: Bindings }>();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use("*", logger());
app.use("*", secureHeaders());

// CORS — allow the landing page and any upcart.online origin
app.use("*", async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? "*")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);

  return cors({
    origin: origins.includes("*") ? "*" : origins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })(c, next);
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json({ ok: true, data: { service: "upcart-provisioning", version: "1.0.0" } })
);

app.get("/health", (c) =>
  c.json({ ok: true, data: { status: "healthy" } })
);

// ─── Routes ────────────────────────────────────────────────────────────────────

// POST /provision           — create a new store
// GET  /provision/check-subdomain?name=... — availability check
app.route("/provision", provisionRouter);

// GET /provision/:id/status — poll provisioning progress
app.route("/provision", statusRouter);

// POST /auth/login          — central dashboard login (proxies to tenant worker)
// GET  /auth/context         — public tenant metadata for dashboard UI
app.route("/auth", authRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }, 404)
);

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

// ─── Cron finalizer ──────────────────────────────────────────────────────────
//
// Provisioning's POST /provision flow leaves a new tenant in "finalizing"
// once all Cloudflare resources (D1, R2, Worker, DNS, Custom Domain) are
// created. It does NOT wait for Custom Domain SSL / edge propagation — that
// can take anywhere from 30s to several minutes and regularly exceeded the
// Worker invocation budget inside ctx.waitUntil, leaving tenants stuck.
//
// Instead, this scheduled handler fires on a cron trigger (see wrangler.toml)
// and for every tenant still in "finalizing" it:
//   1. fetches <store_url>/health — skip if not healthy yet
//   2. POSTs <store_url>/setup with the signup payload stored in
//      `provisioning_data` plus the tenant's `password_hash` (we don't keep
//      the plaintext password anywhere — the tenant worker's /setup accepts
//      an already-PBKDF2-hashed password via `admin.password_hash`).
//      409 means /setup already ran on a previous tick; treat as success.
//   3. seeds a placeholder product via the JWT /setup returned (best-effort)
//   4. flips status → "active" and clears provisioning_data
//   5. if the tenant has been finalizing for > 60 min, flips → "failed"
//
// Each tenant is processed in its own try/catch so one flaky store can't
// block activation of the others.
async function finalizePendingTenants(env: Bindings): Promise<void> {
  console.log(`[${new Date().toISOString()}] Running finalizePendingTenants cron...`);
  const tenantDB   = new TenantDB(env.DB);
  const finalizing = await tenantDB.getFinalizingTenants();

  for (const tenant of finalizing) {
    const storeUrl = tenant.store_url ?? `https://${tenant.subdomain}.${env.BASE_DOMAIN}`;
    try {
      if (!(await probeHealthy(storeUrl))) {
        await failIfTooOld(tenantDB, tenant, "Health check timeout after 60 minutes");
        continue;
      }

      if (!tenant.provisioning_data) {
        // Edge case: provisioning_data was already cleared (e.g. by an older
        // code path) but status was never flipped. Nothing left to replay —
        // just activate.
        await tenantDB.updateStatus(tenant.id, "active");
        console.log(`Cron activated tenant ${tenant.id} (${tenant.subdomain}) (no provisioning_data to replay)`);
        continue;
      }

      let pd: ProvisioningData;
      try {
        pd = JSON.parse(tenant.provisioning_data);
      } catch {
        console.error(`Cron: provisioning_data JSON invalid for ${tenant.id}; failing.`);
        await tenantDB.updateStatus(tenant.id, "failed", "Corrupted provisioning_data");
        continue;
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

      // 409 = /setup already ran on a previous tick. That's fine — we still
      // want to seed (idempotent 409 there too) and flip active.
      if (!setupRes.ok && setupRes.status !== 409) {
        const body = await setupRes.text().catch(() => "");
        console.error(`Cron: /setup failed for ${tenant.id} (${setupRes.status}): ${body}`);
        await failIfTooOld(tenantDB, tenant, `/setup returned ${setupRes.status}`);
        continue;
      }

      if (setupRes.ok) {
        const body = await setupRes.clone().json().catch(() => null) as
          | { ok?: boolean; data?: { token?: string } } | null;
        const token = body?.ok ? body.data?.token : undefined;
        if (token) await seedStarterProduct(storeUrl, token, pd.store.currency);
      }

      await tenantDB.updateStatus(tenant.id, "active");
      await tenantDB.clearProvisioningData(tenant.id);
      console.log(`Cron activated tenant ${tenant.id} (${tenant.subdomain})`);
    } catch (e) {
      console.error(`Cron: unexpected error for tenant ${tenant.id} (${tenant.subdomain}):`, e);
      await failIfTooOld(tenantDB, tenant, (e as Error).message ?? "Cron error");
    }
  }
}

type ProvisioningData = {
  store: { name: string; description: string; currency: string; country: string; theme: string };
  admin: { username: string; email: string };
  stripe_publishable_key: string;
};

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

async function failIfTooOld(
  tenantDB: TenantDB,
  tenant: { id: string; subdomain: string; updated_at: string },
  reason: string,
): Promise<void> {
  const ageMinutes = (Date.now() - new Date(tenant.updated_at).getTime()) / 60_000;
  if (ageMinutes > 60) {
    await tenantDB.updateStatus(tenant.id, "failed", reason);
    console.log(`Cron marked tenant ${tenant.id} (${tenant.subdomain}) as failed: ${reason}`);
  } else {
    console.log(
      `Cron: tenant ${tenant.id} (${tenant.subdomain}) still finalizing ` +
      `(${ageMinutes.toFixed(1)}m old): ${reason}`
    );
  }
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

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(finalizePendingTenants(env));
  },
} satisfies ExportedHandler<Bindings>;
