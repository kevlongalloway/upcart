// /permissions — CRUD over the permission catalogue.
//
// System permissions (is_system = 1) are read-only; updating display_name or
// category is fine, deleting them is not. Custom permissions are admin-
// editable to support new management modules without a migration.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const permissionsRouter = new Hono<Env>();

const PERM_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const createPermSchema = z.object({
  key:          z.string().regex(PERM_KEY_RE, '"<resource>.<action>" e.g. "moderation.flag_content"'),
  display_name: z.string().min(1).max(120),
  description:  z.string().max(500).optional(),
  category:     z.string().min(1).max(80),
});

const updatePermSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
  description:  z.string().max(500).nullable().optional(),
  category:     z.string().min(1).max(80).optional(),
}).refine(o => Object.keys(o).length > 0, "At least one field is required.");

// ─── List permissions ─────────────────────────────────────────────────────────

permissionsRouter.get("/", requirePermissions("permissions.read"), async (c) => {
  const category = c.req.query("category");
  const db = new AdminDB(c.env);
  const items = await db.permissions.list(category ? { category } : {});
  return c.json(ok({ items }));
});

// ─── Create permission ────────────────────────────────────────────────────────

permissionsRouter.post(
  "/",
  requirePermissions("permissions.create"),
  zValidator("json", createPermSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db    = new AdminDB(c.env);

    if (await db.permissions.getByKey(input.key)) {
      return c.json(err("A permission with this key already exists."), 409);
    }

    const perm = await db.permissions.create({ ...input, is_system: false });
    await audit(c, {
      action: "permission.create",
      resource_type: "permission",
      resource_id: perm.id,
      metadata: { key: perm.key, category: perm.category },
    });
    return c.json(ok(perm), 201);
  },
);

// ─── Update permission ────────────────────────────────────────────────────────

permissionsRouter.patch(
  "/:id",
  requirePermissions("permissions.update"),
  zValidator("json", updatePermSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("id");
    const patch = c.req.valid("json");
    const db    = new AdminDB(c.env);

    const perm = await db.permissions.getById(id);
    if (!perm) return c.json(err("Permission not found."), 404);

    const updates: Parameters<typeof db.permissions.update>[1] = {};
    if (patch.display_name !== undefined) updates.display_name = patch.display_name;
    if (patch.description  !== undefined) updates.description  = patch.description;
    if (patch.category     !== undefined) updates.category     = patch.category;

    const updated = await db.permissions.update(id, updates);
    await audit(c, {
      action: "permission.update",
      resource_type: "permission",
      resource_id: id,
      metadata: { fields: Object.keys(patch) },
    });
    return c.json(ok(updated));
  },
);

// ─── Delete permission ────────────────────────────────────────────────────────

permissionsRouter.delete("/:id", requirePermissions("permissions.delete"), async (c) => {
  const id = c.req.param("id");
  const db = new AdminDB(c.env);

  const perm = await db.permissions.getById(id);
  if (!perm) return c.json(err("Permission not found."), 404);
  if (perm.is_system) return c.json(err("System permissions cannot be deleted."), 400);

  await db.permissions.delete(id);

  await audit(c, {
    action: "permission.delete",
    resource_type: "permission",
    resource_id: id,
    metadata: { key: perm.key },
  });

  return c.json(ok({ deleted: true }));
});
