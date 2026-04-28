import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_TTL = 60 * 60 * 8; // 8 hours
const PBKDF2_ITERATIONS = 100_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

const VALID_THEMES = new Set(["base", "mono", "minimal", "boutique", "bold", "studio"]);

const setupSchema = z.object({
  store: z.object({
    name:        z.string().min(1, "Store name is required").max(100),
    description: z.string().max(500).optional().default(""),
    currency:    z.string().length(3, "Currency must be a 3-letter ISO code"),
    country:     z.string().length(2, "Country must be a 2-letter ISO code"),
    theme:       z.string().optional().default("base").transform(t => VALID_THEMES.has(t) ? t : "base"),
  }),
  admin: z.object({
    username: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(50)
      .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores"),
    email:    z.string().email().optional().or(z.literal("")).transform(v => v || undefined),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
  // Stripe publishable key is no longer required — the platform manages
  // payments via Stripe Connect. Kept as optional for backwards compat.
  stripe_publishable_key: z.string().optional().default(""),
});

// ─── Password utilities ───────────────────────────────────────────────────────

/**
 * Hash a password using PBKDF2-SHA256 via the Web Crypto API (available in
 * Cloudflare Workers). Returns a "<salt_hex>:<hash_hex>" string.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder   = new TextEncoder();
  const salt      = crypto.getRandomValues(new Uint8Array(16));
  const keyMat    = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits      = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMat, 256
  );
  const toHex     = (buf: Uint8Array) =>
    Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

/**
 * Verify a password against a stored "<salt_hex>:<hash_hex>" string.
 * Uses a constant-time comparison to resist timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const encoder  = new TextEncoder();
  const salt     = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const keyMat   = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits     = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMat, 256
  );
  const candidate = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  if (candidate.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const setup = new Hono<{ Bindings: Bindings }>();

/**
 * GET /setup/status
 * Returns whether the store has been configured via the onboarding wizard.
 * Used by the onboarding UI to decide whether to show the wizard or sign-in.
 */
setup.get("/status", async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT value FROM store_settings WHERE key = 'setup_complete'"
    ).first<{ value: string }>();
    return c.json(ok({ configured: !!row }));
  } catch {
    // Table may not exist yet on fresh deployments — treat as unconfigured.
    return c.json(ok({ configured: false }));
  }
});

/**
 * POST /setup
 * One-time store configuration endpoint. Creates admin account, stores
 * store settings, and returns a JWT so the user is immediately signed in.
 *
 * Protected: returns 409 if setup has already been completed.
 */
setup.post("/", zValidator("json", setupSchema), async (c) => {
  const db = c.env.DB;

  // ── Guard: already configured ─────────────────────────────────────────────
  try {
    const existing = await db.prepare(
      "SELECT value FROM store_settings WHERE key = 'setup_complete'"
    ).first<{ value: string }>();
    if (existing) {
      return c.json(err("Store is already configured. Please sign in."), 409);
    }
  } catch {
    // Tables may not exist yet — proceed with setup.
  }

  const { store, admin, stripe_publishable_key } = c.req.valid("json");
  const theme = store.theme ?? "mono";

  // ── Resolve tenant ID ─────────────────────────────────────────────────────
  // Set by the provisioning service via TENANT_ID env var. Falls back to a
  // generated value for manual (non-provisioned) deployments.
  const tenantId = c.env.TENANT_ID || crypto.randomUUID();

  // ── Ensure tables exist (idempotent bootstrap) ────────────────────────────
  // This lets the setup endpoint work even before migrations are applied,
  // removing the need for a separate `wrangler d1 migrations apply` step on
  // first run.
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS store_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        tenant_id  TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS admin_accounts (
        id            TEXT PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        email         TEXT,
        password_hash TEXT NOT NULL,
        tenant_id     TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (e) {
    console.error("Failed to ensure setup tables:", e);
    return c.json(err("Database error during setup. Check your D1 configuration."), 500);
  }

  // ── Hash password ─────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(admin.password);
  const adminId      = crypto.randomUUID();

  // ── Resolve JWT secret ────────────────────────────────────────────────────
  // Use the wrangler secret if available; otherwise generate and persist one.
  let jwtSecret = c.env.JWT_SECRET;
  if (!jwtSecret) {
    jwtSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ── Persist all settings atomically ──────────────────────────────────────
  try {
    await db.batch([
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('store_name',              ?, ?, datetime('now'))").bind(store.name, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('store_description',      ?, ?, datetime('now'))").bind(store.description ?? "", tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('currency',               ?, ?, datetime('now'))").bind(store.currency, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('country',                ?, ?, datetime('now'))").bind(store.country, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('theme',                  ?, ?, datetime('now'))").bind(theme, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('stripe_publishable_key', ?, ?, datetime('now'))").bind(stripe_publishable_key ?? "", tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('db_jwt_secret',          ?, ?, datetime('now'))").bind(jwtSecret, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('tenant_id',              ?, ?, datetime('now'))").bind(tenantId, tenantId),
      db.prepare("INSERT INTO admin_accounts (id, username, email, password_hash, tenant_id) VALUES (?, ?, ?, ?, ?)").bind(adminId, admin.username, admin.email ?? null, passwordHash, tenantId),
      db.prepare("INSERT OR REPLACE INTO store_settings (key, value, tenant_id, updated_at) VALUES ('setup_complete', 'true', ?, datetime('now'))").bind(tenantId),
    ]);
  } catch (e) {
    console.error("Setup batch failed:", e);
    return c.json(err("Setup failed. Ensure the D1 database is correctly configured."), 500);
  }

  // ── Issue JWT ─────────────────────────────────────────────────────────────
  const now   = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: "admin", iat: now, exp: now + TOKEN_TTL },
    jwtSecret,
    "HS256"
  );

  return c.json(ok({ token }), 201);
});
