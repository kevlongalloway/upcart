import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

// ─── Settings route ───────────────────────────────────────────────────────────
//
// Thin wrapper around the `store_settings` key-value table. Two surfaces:
//
//   GET  /settings/public        — unauthenticated; what the storefront renders.
//   GET  /admin/settings         — admin; returns every tunable on one page.
//   PUT  /admin/settings         — admin; updates theme, brand colors, logo,
//                                  store name, tagline.
//
// Keeping this in a dedicated file (rather than bolting more rows onto
// `admin.ts`) makes it easy to add more tunables later — email-from address,
// tax settings, etc. — without one giant router file.

// Keys we expose on the public surface. If it's not in this set, the
// storefront never sees it.
const PUBLIC_KEYS = [
  "store_name",
  "store_description",
  "theme",
  "brand_primary",
  "brand_accent",
  "logo_url",
  "currency",
  "hero_title",
  "hero_subtitle",
  "hero_cta",
  "page_sections",   // JSON-encoded section layout for the Store Editor
  "active_theme_id", // id of the catalog theme currently applied (or "")
] as const;

// Additional admin-only keys (kept internal). We don't currently return these
// on PUT responses, but they're preserved on the store_settings table.
const ADMIN_KEYS = [
  "country",
] as const;

const ALL_KEYS = [...PUBLIC_KEYS, ...ADMIN_KEYS] as const;
type SettingKey = typeof ALL_KEYS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readSettings(
  db: D1Database,
  keys: readonly string[],
): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(",");
  const rows = await db
    .prepare(`SELECT key, value FROM store_settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();

  const out: Record<string, string> = {};
  for (const row of rows.results ?? []) out[row.key] = row.value;
  return out;
}

async function writeSettings(
  db: D1Database,
  tenantId: string,
  entries: Record<string, string | null | undefined>,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO store_settings (key, value, tenant_id, updated_at)
             VALUES (?1, ?2, ?3, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             value      = excluded.value,
             tenant_id  = excluded.tenant_id,
             updated_at = datetime('now')`,
        )
        .bind(key, value ?? "", tenantId),
    );
  }
  if (stmts.length) await db.batch(stmts);
}

// ─── Public router ────────────────────────────────────────────────────────────

/**
 * GET /settings/public
 *
 * Unauthenticated endpoint consumed by the storefront at page load. Returns
 * only the subset of store_settings the customer-facing site is allowed to
 * render (theme, logo, colors, store name, description, currency).
 *
 * Callers should treat every field as optional — fresh stores may not have a
 * `brand_primary` / `logo_url` yet, and the storefront falls back to its
 * built-in theme presets.
 */
export const publicSettings = new Hono<{ Bindings: Bindings }>();

publicSettings.get("/", async (c) => {
  // No caching: the storefront fetches this on every page load to pick up the
  // latest editor save. A stale cache here means saved edits invisibly lag
  // behind on customer browsers, which is exactly the bug we're avoiding.
  c.header("Cache-Control", "no-store");
  try {
    const rows = await readSettings(c.env.DB, PUBLIC_KEYS);
    return c.json(ok({
      store_name:        rows.store_name        ?? c.env.STORE_NAME ?? "",
      store_description: rows.store_description ?? "",
      theme:             rows.theme             ?? "base",
      brand_primary:     rows.brand_primary     ?? "",
      brand_accent:      rows.brand_accent      ?? "",
      logo_url:          rows.logo_url          ?? "",
      currency:          rows.currency          ?? c.env.DEFAULT_CURRENCY ?? "usd",
      hero_title:        rows.hero_title        ?? "",
      hero_subtitle:     rows.hero_subtitle     ?? "",
      hero_cta:          rows.hero_cta          ?? "",
      page_sections:     rows.page_sections     ?? "",
      active_theme_id:   rows.active_theme_id   ?? "",
    }));
  } catch (e) {
    console.error("GET /settings/public failed:", e);
    // A fresh store without the table shouldn't break the storefront —
    // return empty defaults so the client falls through to its built-ins.
    return c.json(ok({
      store_name:        c.env.STORE_NAME ?? "",
      store_description: "",
      theme:             "base",
      brand_primary:     "",
      brand_accent:      "",
      logo_url:          "",
      currency:          c.env.DEFAULT_CURRENCY ?? "usd",
      hero_title:        "",
      hero_subtitle:     "",
      hero_cta:          "",
      page_sections:     "",
      active_theme_id:   "",
    }));
  }
});

// ─── Admin router ─────────────────────────────────────────────────────────────

export const adminSettings = new Hono<{ Bindings: Bindings }>();

adminSettings.get("/", async (c) => {
  const rows = await readSettings(c.env.DB, ALL_KEYS);
  return c.json(ok({
    store_name:        rows.store_name        ?? c.env.STORE_NAME ?? "",
    store_description: rows.store_description ?? "",
    theme:             rows.theme             ?? "base",
    brand_primary:     rows.brand_primary     ?? "",
    brand_accent:      rows.brand_accent      ?? "",
    logo_url:          rows.logo_url          ?? "",
    currency:          rows.currency          ?? c.env.DEFAULT_CURRENCY ?? "usd",
    country:           rows.country           ?? c.env.STORE_COUNTRY ?? "",
    hero_title:        rows.hero_title        ?? "",
    hero_subtitle:     rows.hero_subtitle     ?? "",
    hero_cta:          rows.hero_cta          ?? "",
    page_sections:     rows.page_sections     ?? "",
    active_theme_id:   rows.active_theme_id   ?? "",
  }));
});

// Legacy preset names kept only for back-compat with the retired theme.js
// palette system. The schema-driven catalog uses `active_theme_id` instead.
const VALID_THEMES = new Set(["base", "mono", "minimal", "boutique", "bold", "studio"]);
const hex6 = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color like #1a1a1a")
  .or(z.literal(""));

const updateSchema = z
  .object({
    store_name:        z.string().min(0).max(100).optional(),
    store_description: z.string().max(500).optional(),
    theme:             z.string().refine(t => VALID_THEMES.has(t), "Invalid theme").optional(),
    brand_primary:     hex6.optional(),
    brand_accent:      hex6.optional(),
    logo_url:          z.string().url().or(z.literal("")).optional(),
    currency:          z.string().length(3).toLowerCase().optional(),
    hero_title:        z.string().max(100).optional(),
    hero_subtitle:     z.string().max(200).optional(),
    hero_cta:          z.string().max(50).optional(),
    // JSON-encoded page section layout saved by the Store Editor
    page_sections:     z.string().max(524288).optional(),
    // id of the applied catalog theme (slug); "" clears it
    active_theme_id:   z.string().max(64).regex(/^[a-z0-9-]*$/, "Invalid theme id").optional(),
  })
  .strict();

adminSettings.put(
  "/",
  zValidator("json", updateSchema, (result, c) => {
    if (!result.success) {
      // Without an error hook, @hono/zod-validator returns the raw ZodError
      // object as JSON, which the editor stringifies into "[object Object]".
      // Flatten it into a human-readable message + machine-readable details.
      const flat = result.error.flatten();
      const fieldMessages = Object.entries(flat.fieldErrors)
        .map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`)
        .join("; ");
      const message =
        flat.formErrors.join("; ") ||
        fieldMessages ||
        "Invalid request body.";
      return c.json(err(message, flat), 400);
    }
  }),
  async (c) => {
  const body = c.req.valid("json");
  const tenantId = c.env.TENANT_ID || "";

  // Translate undefined keys into "skip this column". We only write what
  // was actually present on the PUT body — partial updates are supported.
  const writes: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    writes[k] = String(v);
  }

  if (Object.keys(writes).length === 0) {
    return c.json(err("No fields to update."), 400);
  }

  try {
    await writeSettings(c.env.DB, tenantId, writes);
  } catch (e) {
    console.error("PUT /admin/settings failed:", e);
    return c.json(err("Failed to save settings. Please try again."), 500);
  }

  const rows = await readSettings(c.env.DB, ALL_KEYS);
  return c.json(ok({
    store_name:        rows.store_name        ?? "",
    store_description: rows.store_description ?? "",
    theme:             rows.theme             ?? "base",
    brand_primary:     rows.brand_primary     ?? "",
    brand_accent:      rows.brand_accent      ?? "",
    logo_url:          rows.logo_url          ?? "",
    currency:          rows.currency          ?? "",
    country:           rows.country           ?? "",
    hero_title:        rows.hero_title        ?? "",
    hero_subtitle:     rows.hero_subtitle     ?? "",
    hero_cta:          rows.hero_cta          ?? "",
    page_sections:     rows.page_sections     ?? "",
    active_theme_id:   rows.active_theme_id   ?? "",
  }));
});
