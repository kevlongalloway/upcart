import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import { Env, Variables, hashPassword, verifyPassword, trialDaysRemaining } from "../types";
import { requireAuth } from "../middleware/auth";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "dashboard", "mail", "ftp", "smtp",
  "support", "help", "docs", "blog", "shop", "store", "status",
  "billing", "pay", "checkout", "dev", "staging", "test", "demo",
  "upcart", "platform", "assets", "cdn", "media", "img", "images",
]);

// ── POST /auth/signup ─────────────────────────────────────────────────────────

const signupSchema = z.object({
  name:       z.string().min(1).max(100).trim(),
  email:      z.string().email().toLowerCase().trim(),
  password:   z.string().min(8).max(128),
  store_name: z.string().min(1).max(100).trim(),
  subdomain:  z
    .string()
    .min(3).max(50)
    .toLowerCase()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Subdomain must be 3–50 chars: lowercase letters, numbers, hyphens (not at start/end)"),
});

auth.post("/signup", zValidator("json", signupSchema), async (c) => {
  const { name, email, password, store_name, subdomain } = c.req.valid("json");
  const db = c.env.PLATFORM_DB;

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return c.json({ error: "This subdomain is reserved. Please choose another." }, 409);
  }

  const [existingUser, existingStore] = await Promise.all([
    db.prepare("SELECT id FROM platform_users WHERE email = ?").bind(email).first(),
    db.prepare("SELECT id FROM stores WHERE subdomain = ?").bind(subdomain).first(),
  ]);

  if (existingUser) return c.json({ error: "An account with this email already exists." }, 409);
  if (existingStore) return c.json({ error: "This subdomain is already taken." }, 409);

  const password_hash = await hashPassword(password);
  const userId  = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const now     = new Date().toISOString();
  const trialDays = parseInt(c.env.TRIAL_DAYS ?? "30", 10);
  const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();

  await db.batch([
    db.prepare(
      "INSERT INTO platform_users (id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, email, password_hash, name, now, now),

    db.prepare(`
      INSERT INTO stores
        (id, platform_user_id, subdomain, store_name, plan_id, trial_ends_at, subscription_status, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'trial', ?, 'trialing', 1, ?, ?)
    `).bind(storeId, userId, subdomain, store_name, trialEndsAt, now, now),
  ]);

  // Create Stripe customer (non-fatal if Stripe not yet configured)
  if (c.env.STRIPE_SECRET_KEY) {
    try {
      const res = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email,
          name,
          "metadata[store_id]": storeId,
          "metadata[subdomain]": subdomain,
        }),
      });
      if (res.ok) {
        const customer = await res.json() as { id: string };
        await db.prepare("UPDATE stores SET stripe_customer_id = ?, updated_at = ? WHERE id = ?")
          .bind(customer.id, new Date().toISOString(), storeId).run();
      }
    } catch {
      // Non-fatal — Stripe customer can be created later
    }
  }

  const token = await sign(
    { sub: userId, store_id: storeId, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    c.env.JWT_SECRET,
    "HS256"
  );

  return c.json({
    token,
    user: { id: userId, name, email },
    store: {
      id: storeId,
      subdomain,
      store_name,
      plan_id: "trial",
      trial_ends_at: trialEndsAt,
      trial_days_remaining: trialDays,
      subscription_status: "trialing",
      store_url: `https://${subdomain}.${c.env.BASE_DOMAIN}`,
    },
  }, 201);
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string(),
});

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const db = c.env.PLATFORM_DB;

  const user = await db.prepare("SELECT * FROM platform_users WHERE email = ?")
    .bind(email).first<{ id: string; name: string; email: string; password_hash: string }>();

  // Always run verifyPassword to prevent timing-based enumeration
  const dummyHash = "AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, dummyHash).then(() => false);

  if (!user || !valid) {
    return c.json({ error: "Invalid email or password." }, 401);
  }

  const store = await db.prepare("SELECT * FROM stores WHERE platform_user_id = ? AND is_active = 1")
    .bind(user.id).first<{ id: string; subdomain: string; store_name: string; plan_id: string; trial_ends_at: string; subscription_status: string; custom_domain: string | null }>();

  if (!store) return c.json({ error: "No active store found for this account." }, 404);

  const token = await sign(
    { sub: user.id, store_id: store.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    c.env.JWT_SECRET,
    "HS256"
  );

  return c.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    store: {
      id: store.id,
      subdomain: store.subdomain,
      store_name: store.store_name,
      plan_id: store.plan_id,
      trial_ends_at: store.trial_ends_at,
      subscription_status: store.subscription_status,
      custom_domain: store.custom_domain,
      store_url: `https://${store.subdomain}.${c.env.BASE_DOMAIN}`,
    },
  });
});

// ── GET /auth/me (protected) ──────────────────────────────────────────────────

auth.get("/me", requireAuth, async (c) => {
  const { sub, store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const [user, store, plan] = await Promise.all([
    db.prepare("SELECT id, email, name, created_at FROM platform_users WHERE id = ?").bind(sub).first<{ id: string; email: string; name: string; created_at: string }>(),
    db.prepare("SELECT * FROM stores WHERE id = ?").bind(store_id).first(),
    db.prepare("SELECT id, name, price_cents, features, sort_order FROM plans WHERE id = (SELECT plan_id FROM stores WHERE id = ?)").bind(store_id).first<{ id: string; name: string; price_cents: number; features: string; sort_order: number }>(),
  ]);

  if (!user || !store) return c.json({ error: "Account not found." }, 404);

  const s = store as Parameters<typeof trialDaysRemaining>[0];

  return c.json({
    user,
    store: {
      ...s,
      store_url: `https://${s.subdomain}.${c.env.BASE_DOMAIN}`,
      trial_days_remaining: trialDaysRemaining(s),
    },
    plan: plan ? { ...plan, features: JSON.parse(plan.features) } : null,
  });
});

export default auth;
