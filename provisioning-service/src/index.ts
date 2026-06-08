import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import type { Bindings } from "./types.js";
import { provisionRouter } from "./routes/provision.js";
import { statusRouter } from "./routes/status.js";
import { authRouter } from "./routes/auth.js";
import { debugRouter } from "./routes/debug.js";
import { webhookRouter } from "./routes/webhooks.js";
import { themesRouter } from "./routes/themes.js";
import { handleTrialExpiry } from "./jobs/trial-expiry.js";

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
// POST /provision/send-otp  — send email/SMS OTP
// POST /provision/verify-otp — verify OTP code
// POST /provision/verify-payment — create $1 Stripe auth hold
app.route("/provision", provisionRouter);

// GET /provision/:id/status — poll provisioning progress
app.route("/provision", statusRouter);

// POST /auth/login          — central dashboard login (proxies to tenant worker)
// GET  /auth/context         — public tenant metadata for dashboard UI
app.route("/auth", authRouter);

// GET /debug                 — system health: secrets, D1, R2 bundle
// GET /debug/bundle          — verify worker bundle is in R2
// GET /debug/tenants         — list all tenants with status
// GET /debug/tenant?email=   — deep-diagnose why a tenant can't log in
app.route("/debug", debugRouter);

// POST /webhooks/stripe     — Stripe platform subscription lifecycle events
app.route("/webhooks", webhookRouter);

// GET /themes                — central theme catalog (listing)
// GET /themes/:id            — full theme manifest incl. editable schema
app.route("/themes", themesRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }, 404)
);

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

// ─── Exports ───────────────────────────────────────────────────────────────────
// Export both fetch (HTTP handler) and scheduled (cron handler) so Cloudflare
// Workers routes the daily cron trigger to handleTrialExpiry.

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(handleTrialExpiry(env));
  },
};
