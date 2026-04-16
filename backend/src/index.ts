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
import { storefront } from "./storefront/index.js";

// ─── API sub-app ──────────────────────────────────────────────────────────────
//
// Every JSON endpoint lives under /api/*. The root (`/`) of this Worker serves
// the customer storefront (see ./storefront), so API paths are namespaced to
// avoid colliding with storefront routes like /products or /cart.

const api = new Hono<{ Bindings: Bindings }>();

// CORS — must come before CSRF so that preflight requests are handled first.
api.use("*", corsMiddleware());
// CSRF origin check — configured via CSRF_ENABLED.
api.use("*", csrfMiddleware());

// Service identity / health
api.get("/", (c) =>
  c.json({
    ok: true,
    data: {
      service: "upcart-backend",
      version: "1.2.0",
      db: c.env.DB_ADAPTER ?? "d1",
      tenant_id: c.env.TENANT_ID ?? "",
    },
  })
);

api.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

// Public, unauthenticated endpoints.
api.route("/products", products);
api.route("/checkout", checkout);
api.route("/webhooks", webhooks);
api.route("/orders", orderStatus);
api.route("/discounts", discountValidate);
api.route("/setup", setup);
api.route("/connect", connect);

// Admin login is public; the rest of /admin/* requires a JWT.
api.route("/admin/login", adminLogin);
api.use("/admin/*", async (c, next) => {
  if (c.req.path === "/api/admin/login" || c.req.path === "/api/admin/login/") {
    return next();
  }
  return adminAuthMiddleware()(c, next);
});
api.route("/admin", admin);
api.route("/admin/images", images);
api.route("/admin/orders", orders);
api.route("/admin/discounts", discounts);
api.route("/admin/orders", shipping);
api.route("/admin/connect", connect);

// ─── Root app ─────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use("*", secureHeaders());

// Cloudflare / uptime-check health endpoint (no CORS/CSRF required).
app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

// JSON API.
app.route("/api", api);

// Customer storefront — everything else (/, /products, /cart, /success, …).
app.route("/", storefront);

// ─── 404 + error handlers (API-shaped; storefront handles its own 404) ────────

app.notFound((c) =>
  c.json({ ok: false, error: `Route not found: ${c.req.method} ${c.req.path}` }, 404)
);

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

export default app;
