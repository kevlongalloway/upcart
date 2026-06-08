// Central theme-catalog API.
//
// Themes are platform assets identical for every tenant, so they are served
// from the central provisioning service rather than duplicated per-tenant.
// The editor bundles the same built-in themes for offline use; this endpoint
// is the seam future remote / purchasable themes plug into.
//
//   GET /themes        — listing (no heavy schema payload), cacheable
//   GET /themes/:id    — full manifest incl. the editable schema
//
// Payment is NOT implemented: every catalog entry carries `price` (0 = free)
// but nothing here enforces it.

import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { listThemeCatalog, getThemeManifest } from "../defaults/store-schema.js";

export const themesRouter = new Hono<{ Bindings: Bindings }>();

themesRouter.get("/", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ ok: true, data: listThemeCatalog() });
});

themesRouter.get("/:id", (c) => {
  const id = c.req.param("id");
  const manifest = getThemeManifest(id);
  if (!manifest) {
    return c.json({ ok: false, error: `Theme not found: ${id}` }, 404);
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ ok: true, data: manifest });
});
