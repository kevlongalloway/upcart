import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import type { Bindings } from "./types.js";
import { provisionRouter } from "./routes/provision.js";
import { statusRouter } from "./routes/status.js";

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

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }, 404)
);

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

export default app;
