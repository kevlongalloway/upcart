import { Hono } from "hono";
import type { Bindings } from "../types.js";

// HTML pages — imported as raw text by wrangler's Text rule (see wrangler.toml).
import indexHtml    from "./assets/index.html";
import productsHtml from "./assets/products.html";
import productHtml  from "./assets/product.html";
import cartHtml     from "./assets/cart.html";
import successHtml  from "./assets/success.html";

// Shared client scripts (served as text/javascript).
import themeJs from "./assets/theme.js.txt";
import cartJs  from "./assets/cart.js.txt";

// ─── Per-tenant settings loader ───────────────────────────────────────────────
//
// The storefront is dynamic: theme, store name, and currency come from
// store_settings in the tenant's D1. We read these once per request for
// /config.js and inject them into the page so the static HTML remains the same
// across tenants.

type StorefrontSettings = {
  apiBase:     string;
  theme:       string;
  storeName:   string;
  currency:    string;
  description: string;
};

async function loadSettings(env: Bindings): Promise<StorefrontSettings> {
  const defaults: StorefrontSettings = {
    apiBase:     "/api",
    theme:       "mono",
    storeName:   env.STORE_NAME || "Store",
    currency:    env.DEFAULT_CURRENCY || "usd",
    description: "",
  };

  try {
    const rows = await env.DB.prepare(
      "SELECT key, value FROM store_settings WHERE key IN ('theme','store_name','currency','store_description')"
    ).all<{ key: string; value: string }>();

    const map: Record<string, string> = {};
    for (const row of rows.results ?? []) map[row.key] = row.value;

    return {
      apiBase:     "/api",
      theme:       map.theme           ?? defaults.theme,
      storeName:   map.store_name      ?? defaults.storeName,
      currency:    map.currency        ?? defaults.currency,
      description: map.store_description ?? defaults.description,
    };
  } catch {
    return defaults;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeJsString(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replace the default "Demo Store" / "Store" placeholders in the raw template
 * with the tenant's actual store name, and rewrite the <title>/<meta> for SEO.
 * Keeps the storefront universal while each tenant sees their own branding.
 */
function renderPage(html: string, settings: StorefrontSettings): string {
  const name = escapeHtml(settings.storeName);
  const desc = escapeHtml(settings.description || `Shop ${settings.storeName}`);

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace(
      /<meta property="og:title" content="[^"]*">/,
      `<meta property="og:title" content="${name}">`
    )
    .replace(
      /<meta property="og:description" content="[^"]*">/,
      `<meta property="og:description" content="${desc}">`
    )
    // Only rewrite visible "Demo Store" labels — avoid matching page IDs, etc.
    .replace(/>Demo Store</g, `>${name}<`)
    .replace(/aria-label="Demo Store"/g, `aria-label="${name}"`);
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const storefront = new Hono<{ Bindings: Bindings }>();

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };
const JS_HEADERS   = { "Content-Type": "application/javascript; charset=utf-8" };

// Cache static scripts aggressively — they're built into the bundle.
const STATIC_JS_HEADERS = {
  ...JS_HEADERS,
  "Cache-Control": "public, max-age=3600",
};

// Runtime-generated config — theme/name come from D1.
storefront.get("/config.js", async (c) => {
  const s = await loadSettings(c.env);
  const body =
    `window.BST_API_BASE="${escapeJsString(s.apiBase)}";` +
    `window.STORE_THEME="${escapeJsString(s.theme)}";` +
    `window.STORE_NAME="${escapeJsString(s.storeName)}";` +
    `window.STORE_CURRENCY="${escapeJsString(s.currency)}";\n`;
  return new Response(body, {
    headers: {
      ...JS_HEADERS,
      // No-cache so theme/name changes in the admin dashboard take effect
      // on the next page load.
      "Cache-Control": "no-store",
    },
  });
});

storefront.get("/theme.js", () => new Response(themeJs, { headers: STATIC_JS_HEADERS }));
storefront.get("/cart.js",  () => new Response(cartJs,  { headers: STATIC_JS_HEADERS }));

// Storefront pages.
storefront.get("/", async (c) => {
  const s = await loadSettings(c.env);
  return new Response(renderPage(indexHtml, s), { headers: HTML_HEADERS });
});

storefront.get("/products.html", async (c) => {
  const s = await loadSettings(c.env);
  return new Response(renderPage(productsHtml, s), { headers: HTML_HEADERS });
});

storefront.get("/product.html", async (c) => {
  const s = await loadSettings(c.env);
  return new Response(renderPage(productHtml, s), { headers: HTML_HEADERS });
});

storefront.get("/cart.html", async (c) => {
  const s = await loadSettings(c.env);
  return new Response(renderPage(cartHtml, s), { headers: HTML_HEADERS });
});

storefront.get("/success.html", async (c) => {
  const s = await loadSettings(c.env);
  return new Response(renderPage(successHtml, s), { headers: HTML_HEADERS });
});

// Friendly alias paths.
storefront.get("/products", (c) => c.redirect("/products.html", 301));
storefront.get("/cart",     (c) => c.redirect("/cart.html", 301));

// Apple Pay domain association — merchants who configure Apple Pay in Stripe
// can paste their verification string as STRIPE_APPLE_PAY_DOMAIN_ASSOC in
// their Worker's vars; this route serves it at the exact path Stripe requires.
storefront.get("/.well-known/apple-developer-merchantid-domain-association", (c) => {
  const body = (c.env as Bindings & { STRIPE_APPLE_PAY_DOMAIN_ASSOC?: string })
    .STRIPE_APPLE_PAY_DOMAIN_ASSOC || "";
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
});
