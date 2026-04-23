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
//   1. fetches <store_url>/health
//   2. if the tenant worker replies with { ok:true, data:{ status:"healthy" } },
//      flips status → "active"
//   3. if the tenant has been finalizing for > 60 min, flips status → "failed"
//      with a timeout message so the dashboard stops pretending it's working
async function finalizePendingTenants(env: Bindings): Promise<void> {
  console.log(`[${new Date().toISOString()}] Running finalizePendingTenants cron...`);
  const tenantDB   = new TenantDB(env.DB);
  const finalizing = await tenantDB.getFinalizingTenants();

  for (const tenant of finalizing) {
    const storeUrl = tenant.store_url ?? `https://${tenant.subdomain}.${env.BASE_DOMAIN}`;
    try {
      const ping = await fetch(`${storeUrl}/health`, { method: "GET" });

      if (ping.ok) {
        const data = await ping.json().catch(() => ({})) as {
          ok?: boolean; data?: { status?: string };
        };
        if (data.ok === true && data.data?.status === "healthy") {
          await tenantDB.updateStatus(tenant.id, "active");
          console.log(`Cron activated tenant ${tenant.id} (${tenant.subdomain})`);
          continue;
        }
      }

      const ageMinutes = (Date.now() - new Date(tenant.updated_at).getTime()) / 60_000;
      if (ageMinutes > 60) {
        await tenantDB.updateStatus(tenant.id, "failed", "Health check timeout after 60 minutes");
        console.log(`Cron marked tenant ${tenant.id} (${tenant.subdomain}) as failed (timeout)`);
      } else {
        console.log(
          `Cron: tenant ${tenant.id} (${tenant.subdomain}) still finalizing ` +
          `(${ageMinutes.toFixed(1)}m old, /health not yet healthy)`
        );
      }
    } catch (e) {
      console.error(`Cron: /health error for tenant ${tenant.id} (${tenant.subdomain}):`, e);
    }
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
