import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env, Variables, Store, trialDaysRemaining } from "../types";
import { requireAuth } from "../middleware/auth";

const stores = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── GET /stores/check/:subdomain (public) ─────────────────────────────────────

const RESERVED = new Set([
  "www", "app", "api", "admin", "dashboard", "mail", "ftp", "smtp",
  "support", "help", "docs", "blog", "shop", "store", "status",
  "billing", "pay", "checkout", "dev", "staging", "test", "demo",
  "upcart", "platform", "assets", "cdn", "media", "img", "images",
]);

stores.get("/check/:subdomain", async (c) => {
  const subdomain = c.req.param("subdomain").toLowerCase().trim();

  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(subdomain)) {
    return c.json({ available: false, reason: "Invalid format. Use 3–50 lowercase letters, numbers, or hyphens." });
  }
  if (RESERVED.has(subdomain)) {
    return c.json({ available: false, reason: "This subdomain is reserved." });
  }

  const existing = await c.env.PLATFORM_DB
    .prepare("SELECT id FROM stores WHERE subdomain = ?").bind(subdomain).first();

  return c.json({
    available: !existing,
    subdomain,
    url: `https://${subdomain}.${c.env.BASE_DOMAIN}`,
  });
});

// ── GET /stores/resolve (public — internal use by backend worker) ─────────────
// Called by the backend worker to resolve a host → tenant store info.
// The backend worker binds PLATFORM_DB directly (see backend/wrangler.toml),
// so this HTTP endpoint is a fallback / debugging tool.

stores.get("/resolve", async (c) => {
  const host = c.req.query("host");
  if (!host) return c.json({ error: "Missing ?host= parameter." }, 400);

  const db = c.env.PLATFORM_DB;

  // Try exact custom domain first
  let store = await db.prepare(
    "SELECT id, subdomain, store_name, plan_id, subscription_status, trial_ends_at, is_active FROM stores WHERE custom_domain = ? AND custom_domain_verified = 1"
  ).bind(host).first<Store>();

  if (!store) {
    // Extract subdomain from host (e.g. "mystore.yourdomain.com" → "mystore")
    const sub = host.split(".")[0];
    store = await db.prepare(
      "SELECT id, subdomain, store_name, plan_id, subscription_status, trial_ends_at, is_active FROM stores WHERE subdomain = ?"
    ).bind(sub).first<Store>();
  }

  if (!store) return c.json({ error: "Store not found." }, 404);

  return c.json({
    store_id: store.id,
    subdomain: store.subdomain,
    store_name: store.store_name,
    plan_id: store.plan_id,
    subscription_status: store.subscription_status,
    trial_ends_at: store.trial_ends_at,
    trial_days_remaining: trialDaysRemaining(store),
    is_active: store.is_active,
  });
});

// ── GET /stores/me (protected) ────────────────────────────────────────────────

stores.get("/me", requireAuth, async (c) => {
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const store = await db.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(store_id).first<Store>();
  if (!store) return c.json({ error: "Store not found." }, 404);

  const plan = await db.prepare("SELECT id, name, price_cents, features FROM plans WHERE id = ?")
    .bind(store.plan_id).first<{ id: string; name: string; price_cents: number; features: string }>();

  return c.json({
    ...store,
    store_url: `https://${store.subdomain}.${c.env.BASE_DOMAIN}`,
    trial_days_remaining: trialDaysRemaining(store),
    plan: plan ? { ...plan, features: JSON.parse(plan.features) } : null,
  });
});

// ── PUT /stores/me (protected) ────────────────────────────────────────────────

const updateSchema = z.object({
  store_name:  z.string().min(1).max(100).trim().optional(),
  store_email: z.string().email().toLowerCase().trim().optional().nullable(),
}).strict();

stores.put("/me", requireAuth, zValidator("json", updateSchema), async (c) => {
  const updates = c.req.valid("json");
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.store_name !== undefined) { setClauses.push("store_name = ?");  values.push(updates.store_name); }
  if (updates.store_email !== undefined) { setClauses.push("store_email = ?"); values.push(updates.store_email); }

  if (setClauses.length === 0) return c.json({ error: "Nothing to update." }, 400);

  setClauses.push("updated_at = ?");
  values.push(new Date().toISOString(), store_id);

  await db.prepare(`UPDATE stores SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values).run();

  const store = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(store_id).first<Store>();
  return c.json({
    ...store,
    store_url: `https://${store!.subdomain}.${c.env.BASE_DOMAIN}`,
    trial_days_remaining: trialDaysRemaining(store!),
  });
});

export default stores;
