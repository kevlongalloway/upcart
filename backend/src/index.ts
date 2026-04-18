import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Bindings } from "./types.js";
import { corsMiddleware } from "./middleware/cors.js";
import { csrfMiddleware } from "./middleware/csrf.js";
import { adminAuthMiddleware } from "./middleware/auth.js";
import { products } from "./routes/products.js";
import { admin } from "./routes/admin.js";
import { adminLogin } from "./routes/adminLogin.js";
import { checkout } from "./routes/checkout.js";
import { webhooks } from "./routes/webhooks.js";
import images from "./routes/images.js";
import { orders } from "./routes/orders.js";
import { shipping } from "./routes/shipping.js";
import { orderStatus } from "./routes/orderStatus.js";
import { discounts } from "./routes/discounts.js";
import { discountValidate } from "./routes/discountValidate.js";
import { setup } from "./routes/setup.js";
import { connect } from "./routes/connect.js";
import { publicSettings, adminSettings } from "./routes/settings.js";

const app = new Hono<{ Bindings: Bindings }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use("*", logger());

// Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use("*", secureHeaders());

// CORS — must come before CSRF so that preflight requests are handled first.
app.use("*", corsMiddleware());

// CSRF origin check — configured via CSRF_ENABLED in wrangler.toml.
app.use("*", csrfMiddleware());

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    ok: true,
    data: {
      service: "e-commaxxing",
      version: "1.1.0",
      db: c.env.DB_ADAPTER ?? "d1",
    },
  })
);

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

// ─── Public Routes ────────────────────────────────────────────────────────────

// Product catalog (read-only, publicly accessible)
app.route("/products", products);

// Stripe checkout (publicly accessible — customers initiate purchases)
app.route("/checkout", checkout);

// Stripe webhooks (verified by signature, no auth middleware needed)
app.route("/webhooks", webhooks);

// Public order status lookup (customer-facing, secured by unguessable session_id)
app.route("/orders", orderStatus);

// Public discount validation (customer enters code before checkout)
app.route("/discounts", discountValidate);

// Self-serve setup/onboarding (public — no auth; 409s after first run)
app.route("/setup", setup);

// Stripe Connect onboarding (public — merchant initiates before first login)
app.route("/connect", connect);

// Public storefront settings (theme, colors, logo, store name). Read by the
// customer-facing storefront at page load to render the live brand.
app.route("/settings/public", publicSettings);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

// Login is public — no auth required.
app.route("/admin/login", adminLogin);

// Protect all other /admin/* routes with JWT auth.
// Explicitly exclude /admin/login so the middleware never runs on it.
app.use("/admin/*", async (c, next) => {
  if (c.req.path === "/admin/login" || c.req.path === "/admin/login/") {
    return next();
  }
  return adminAuthMiddleware()(c, next);
});
app.route("/admin", admin);
app.route("/admin/images", images);

// Order management (admin only — protected by the middleware above)
app.route("/admin/orders", orders);

// Discount / promo / sale management (admin only)
app.route("/admin/discounts", discounts);

// Shipping label generation per order (admin only)
app.route("/admin/orders", shipping);

// Stripe Connect balance and withdrawal management (admin only)
app.route("/admin/connect", connect);

// Storefront theme + branding settings (admin only — read/write)
app.route("/admin/settings", adminSettings);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
//
// No API route matched. If the Worker has a static-assets binding (ASSETS),
// fall through to it so the tenant storefront (index.html, products.html, etc.)
// is served from the same origin as the API. If there's no assets binding, or
// the caller clearly wants JSON, return a structured 404.

const API_PREFIXES = ["/admin", "/webhooks", "/setup", "/checkout", "/connect"];

app.notFound(async (c) => {
  const path   = c.req.path;
  const accept = c.req.header("accept") ?? "";
  const looksLikeApi =
    accept.includes("application/json") ||
    API_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));

  if (!c.env.ASSETS || looksLikeApi) {
    return c.json(
      { ok: false, error: `Route not found: ${c.req.method} ${path}` },
      404
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

export default app;
