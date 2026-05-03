// /users — admin staff CRUD + role assignment.
//
// All routes require an authenticated session (mounted under authMiddleware
// in src/index.ts) and the listed permission keys.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { hashPassword } from "../password.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const usersRouter = new Hono<Env>();

const createUserSchema = z.object({
  email:        z.string().email().max(200),
  username:     z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
  password:     z.string().min(8).max(200),
  full_name:    z.string().max(200).optional(),
  status:       z.enum(["active", "suspended", "disabled"]).optional(),
  role_keys:    z.array(z.string().min(1)).optional(),
});

const updateUserSchema = z.object({
  email:     z.string().email().max(200).optional(),
  username:  z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  password:  z.string().min(8).max(200).optional(),
  full_name: z.string().max(200).nullable().optional(),
  status:    z.enum(["active", "suspended", "disabled"]).optional(),
}).refine(o => Object.keys(o).length > 0, "At least one field is required.");

const assignRoleSchema = z.object({
  role_key: z.string().min(1).max(100).optional(),
  role_id:  z.string().uuid().optional(),
}).refine(o => o.role_key || o.role_id, "Provide role_key or role_id.");

// ─── List users ───────────────────────────────────────────────────────────────

usersRouter.get("/", requirePermissions("users.read"), async (c) => {
  const limit  = Math.min(Math.max(1, parseInt(c.req.query("limit")  ?? "50", 10) || 50), 200);
  const offset = Math.max(0,            parseInt(c.req.query("offset") ?? "0",  10) || 0);

  const db    = new AdminDB(c.env);
  const users = await db.users.list({ limit, offset });

  // Hydrate each with their roles/permissions so the portal can render the
  // table without N+1 follow-ups. For very large staff counts switch to a
  // single GROUP_CONCAT query — this is fine up to a few thousand rows.
  const hydrated = await Promise.all(
    users.map(u => db.users.getWithAccess(u.id).then(x => x!)),
  );
  return c.json(ok({ items: hydrated, limit, offset }));
});

// ─── Get user ─────────────────────────────────────────────────────────────────

usersRouter.get("/:id", requirePermissions("users.read"), async (c) => {
  const db   = new AdminDB(c.env);
  const user = await db.users.getWithAccess(c.req.param("id"));
  if (!user) return c.json(err("User not found."), 404);
  return c.json(ok(user));
});

// ─── Create user ──────────────────────────────────────────────────────────────

usersRouter.post(
  "/",
  requirePermissions("users.create"),
  zValidator("json", createUserSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db    = new AdminDB(c.env);
    const actor = c.get("user");

    if (await db.users.getByEmail(input.email)) {
      return c.json(err("A user with this email already exists."), 409);
    }
    if (await db.users.getByUsername(input.username)) {
      return c.json(err("A user with this username already exists."), 409);
    }

    const password_hash = await hashPassword(input.password);
    const created = await db.users.create({
      email:         input.email,
      username:      input.username,
      password_hash,
      full_name:     input.full_name ?? null,
      status:        input.status ?? "active",
      created_by:    actor.id,
    });

    // Optional initial roles. Only a holder of users.assign_role can attach
    // roles here; if the actor lacks that perm we silently skip the grants
    // so the request still succeeds — the user is created but unprivileged.
    const canAssign =
      actor.permissions.includes("*") ||
      actor.permissions.includes("users.assign_role");

    if (canAssign && input.role_keys && input.role_keys.length > 0) {
      for (const key of input.role_keys) {
        const role = await db.roles.getByKey(key);
        if (role) await db.roles.assignToUser(created.id, role.id, actor.id);
      }
    }

    await audit(c, {
      action: "user.create",
      resource_type: "user",
      resource_id: created.id,
      metadata: { email: created.email, role_keys: input.role_keys ?? [] },
    });

    const hydrated = (await db.users.getWithAccess(created.id))!;
    return c.json(ok(hydrated), 201);
  },
);

// ─── Update user ──────────────────────────────────────────────────────────────

usersRouter.patch(
  "/:id",
  requirePermissions("users.update"),
  zValidator("json", updateUserSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("id");
    const patch = c.req.valid("json");
    const db    = new AdminDB(c.env);

    const existing = await db.users.getById(id);
    if (!existing) return c.json(err("User not found."), 404);

    // Refuse if the unique columns collide with another row.
    if (patch.email) {
      const other = await db.users.getByEmail(patch.email);
      if (other && other.id !== id) return c.json(err("Email already in use."), 409);
    }
    if (patch.username) {
      const other = await db.users.getByUsername(patch.username);
      if (other && other.id !== id) return c.json(err("Username already in use."), 409);
    }

    const updates: Parameters<typeof db.users.update>[1] = {};
    if (patch.email     !== undefined) updates.email = patch.email;
    if (patch.username  !== undefined) updates.username = patch.username;
    if (patch.full_name !== undefined) updates.full_name = patch.full_name;
    if (patch.status    !== undefined) updates.status = patch.status;
    if (patch.password  !== undefined) updates.password_hash = await hashPassword(patch.password);

    const updated = await db.users.update(id, updates);

    await audit(c, {
      action: "user.update",
      resource_type: "user",
      resource_id: id,
      metadata: { fields: Object.keys(patch).filter(k => k !== "password") },
    });

    const hydrated = (await db.users.getWithAccess(id))!;
    return c.json(ok(hydrated));
  },
);

// ─── Delete user ──────────────────────────────────────────────────────────────

usersRouter.delete("/:id", requirePermissions("users.delete"), async (c) => {
  const id    = c.req.param("id");
  const db    = new AdminDB(c.env);
  const actor = c.get("user");

  if (id === actor.id) {
    return c.json(err("You cannot delete your own account."), 400);
  }

  const deleted = await db.users.delete(id);
  if (!deleted) return c.json(err("User not found."), 404);

  await audit(c, {
    action: "user.delete",
    resource_type: "user",
    resource_id: id,
    metadata: {},
  });

  return c.json(ok({ deleted: true }));
});

// ─── Assign role to user ──────────────────────────────────────────────────────

usersRouter.post(
  "/:id/roles",
  requirePermissions("users.assign_role"),
  zValidator("json", assignRoleSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const userId = c.req.param("id");
    const body   = c.req.valid("json");
    const db     = new AdminDB(c.env);
    const actor  = c.get("user");

    if (!(await db.users.getById(userId))) {
      return c.json(err("User not found."), 404);
    }

    const role = body.role_id
      ? await db.roles.getById(body.role_id)
      : await db.roles.getByKey(body.role_key!);
    if (!role) return c.json(err("Role not found."), 404);

    await db.roles.assignToUser(userId, role.id, actor.id);
    await audit(c, {
      action: "user.role_assigned",
      resource_type: "user",
      resource_id: userId,
      metadata: { role_id: role.id, role_key: role.key },
    });

    const hydrated = (await db.users.getWithAccess(userId))!;
    return c.json(ok(hydrated));
  },
);

// ─── Revoke role from user ────────────────────────────────────────────────────

usersRouter.delete(
  "/:id/roles/:role_id",
  requirePermissions("users.assign_role"),
  async (c) => {
    const userId = c.req.param("id");
    const roleId = c.req.param("role_id");
    const db     = new AdminDB(c.env);

    const removed = await db.roles.revokeFromUser(userId, roleId);
    if (!removed) return c.json(err("Assignment not found."), 404);

    await audit(c, {
      action: "user.role_revoked",
      resource_type: "user",
      resource_id: userId,
      metadata: { role_id: roleId },
    });

    const hydrated = await db.users.getWithAccess(userId);
    return c.json(ok(hydrated ?? { user_id: userId }));
  },
);
