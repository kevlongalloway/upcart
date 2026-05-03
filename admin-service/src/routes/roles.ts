// /roles — role CRUD + permission attachment.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const rolesRouter = new Hono<Env>();

const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

const createRoleSchema = z.object({
  key:             z.string().regex(ROLE_KEY_RE, "Lowercase letters, digits, underscores; start with a letter."),
  display_name:    z.string().min(1).max(120),
  description:     z.string().max(500).optional(),
  permission_keys: z.array(z.string().min(1)).optional(),
});

const updateRoleSchema = z.object({
  key:          z.string().regex(ROLE_KEY_RE).optional(),
  display_name: z.string().min(1).max(120).optional(),
  description:  z.string().max(500).nullable().optional(),
}).refine(o => Object.keys(o).length > 0, "At least one field is required.");

const attachPermSchema = z.object({
  permission_key: z.string().min(1).max(120).optional(),
  permission_id:  z.string().uuid().optional(),
}).refine(o => o.permission_key || o.permission_id, "Provide permission_key or permission_id.");

// ─── List roles ───────────────────────────────────────────────────────────────

rolesRouter.get("/", requirePermissions("roles.read"), async (c) => {
  const db = new AdminDB(c.env);
  const roles = await db.roles.listWithPermissions();
  return c.json(ok({ items: roles }));
});

// ─── Get role ─────────────────────────────────────────────────────────────────

rolesRouter.get("/:id", requirePermissions("roles.read"), async (c) => {
  const id = c.req.param("id");
  const db = new AdminDB(c.env);
  const role = await db.roles.getById(id);
  if (!role) return c.json(err("Role not found."), 404);
  const permissions = await db.roles.permissionsForRole(role.id);
  return c.json(ok({ ...role, permissions }));
});

// ─── Create role ──────────────────────────────────────────────────────────────

rolesRouter.post(
  "/",
  requirePermissions("roles.create"),
  zValidator("json", createRoleSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db    = new AdminDB(c.env);

    if (await db.roles.getByKey(input.key)) {
      return c.json(err("A role with this key already exists."), 409);
    }

    const role = await db.roles.create({
      key:          input.key,
      display_name: input.display_name,
      description:  input.description ?? null,
      is_system:    false,
    });

    if (input.permission_keys && input.permission_keys.length > 0) {
      for (const permKey of input.permission_keys) {
        const perm = await db.permissions.getByKey(permKey);
        if (perm) await db.roles.attachPermission(role.id, perm.id);
      }
    }

    await audit(c, {
      action: "role.create",
      resource_type: "role",
      resource_id: role.id,
      metadata: { key: role.key, permission_keys: input.permission_keys ?? [] },
    });

    const permissions = await db.roles.permissionsForRole(role.id);
    return c.json(ok({ ...role, permissions }), 201);
  },
);

// ─── Update role ──────────────────────────────────────────────────────────────

rolesRouter.patch(
  "/:id",
  requirePermissions("roles.update"),
  zValidator("json", updateRoleSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("id");
    const patch = c.req.valid("json");
    const db    = new AdminDB(c.env);

    const role = await db.roles.getById(id);
    if (!role) return c.json(err("Role not found."), 404);

    if (role.is_system && (patch.key !== undefined || patch.display_name !== undefined)) {
      return c.json(err("System roles cannot be renamed; description may still be edited."), 400);
    }

    if (patch.key && patch.key !== role.key) {
      const existing = await db.roles.getByKey(patch.key);
      if (existing && existing.id !== id) {
        return c.json(err("A role with this key already exists."), 409);
      }
    }

    const updated = await db.roles.update(id, {
      key:          patch.key,
      display_name: patch.display_name,
      description:  patch.description ?? null,
    });

    await audit(c, {
      action: "role.update",
      resource_type: "role",
      resource_id: id,
      metadata: { fields: Object.keys(patch) },
    });

    const permissions = await db.roles.permissionsForRole(id);
    return c.json(ok({ ...updated!, permissions }));
  },
);

// ─── Delete role ──────────────────────────────────────────────────────────────

rolesRouter.delete("/:id", requirePermissions("roles.delete"), async (c) => {
  const id = c.req.param("id");
  const db = new AdminDB(c.env);

  const role = await db.roles.getById(id);
  if (!role) return c.json(err("Role not found."), 404);
  if (role.is_system) return c.json(err("System roles cannot be deleted."), 400);

  await db.roles.delete(id);

  await audit(c, {
    action: "role.delete",
    resource_type: "role",
    resource_id: id,
    metadata: { key: role.key },
  });

  return c.json(ok({ deleted: true }));
});

// ─── Attach permission to role ────────────────────────────────────────────────

rolesRouter.post(
  "/:id/permissions",
  requirePermissions("roles.assign_permission"),
  zValidator("json", attachPermSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const db   = new AdminDB(c.env);

    const role = await db.roles.getById(id);
    if (!role) return c.json(err("Role not found."), 404);

    const perm = body.permission_id
      ? await db.permissions.getById(body.permission_id)
      : await db.permissions.getByKey(body.permission_key!);
    if (!perm) return c.json(err("Permission not found."), 404);

    await db.roles.attachPermission(role.id, perm.id);

    await audit(c, {
      action: "role.permission_attached",
      resource_type: "role",
      resource_id: role.id,
      metadata: { permission_id: perm.id, permission_key: perm.key },
    });

    const permissions = await db.roles.permissionsForRole(role.id);
    return c.json(ok({ ...role, permissions }));
  },
);

// ─── Detach permission from role ──────────────────────────────────────────────

rolesRouter.delete(
  "/:id/permissions/:permission_id",
  requirePermissions("roles.assign_permission"),
  async (c) => {
    const id           = c.req.param("id");
    const permissionId = c.req.param("permission_id");
    const db           = new AdminDB(c.env);

    const role = await db.roles.getById(id);
    if (!role) return c.json(err("Role not found."), 404);

    // Refuse to strip "*" off superadmin — the system would otherwise lose
    // its only safety net.
    if (role.key === "superadmin") {
      const perm = await db.permissions.getById(permissionId);
      if (perm?.key === "*") {
        return c.json(err("The wildcard permission cannot be removed from the superadmin role."), 400);
      }
    }

    const removed = await db.roles.detachPermission(id, permissionId);
    if (!removed) return c.json(err("Permission not attached to role."), 404);

    await audit(c, {
      action: "role.permission_detached",
      resource_type: "role",
      resource_id: id,
      metadata: { permission_id: permissionId },
    });

    const permissions = await db.roles.permissionsForRole(id);
    return c.json(ok({ ...role, permissions }));
  },
);
