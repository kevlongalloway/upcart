import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env, Variables } from "./types";
import authRoutes from "./routes/auth";
import billingRoutes from "./routes/billing";
import storeRoutes from "./routes/stores";
import domainRoutes from "./routes/domains";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use("*", async (c, next) => {
  const allowed = (c.env.CORS_ORIGINS ?? "*").split(",").map(o => o.trim());
  return cors({
    origin: allowed.length === 1 && allowed[0] === "*" ? "*" : allowed,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  })(c, next);
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/", (c) => c.json({ service: "upcart-platform", version: "1.0.0" }));
app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

// ─── Auth routes (/auth/signup, /auth/login, /auth/me) ────────────────────────

app.route("/auth", authRoutes);

// ─── Store routes (/stores/check/:subdomain, /stores/resolve, /stores/me) ─────

app.route("/stores", storeRoutes);

// ─── Billing routes (/billing/plans, /billing/subscribe, /billing/portal) ─────
// Stripe webhook lives at /billing/webhooks/stripe (public, signature-verified)

app.route("/billing", billingRoutes);

// ─── Domain routes (/domains — POST, GET /verify, DELETE) ─────────────────────

app.route("/domains", domainRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error." }, 500);
});

export default app;
