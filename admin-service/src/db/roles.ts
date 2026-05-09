// Role + role↔permission CRUD against the upcart-admin-db.

import { randomUUID } from "crypto";
import type { Role, Permission, RoleWithPermissions } from "../types.js";

type RoleRow = {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  is_system: number;
  created_at: string;
  updated_at: string;
};

function rowToRole(row: RoleRow): Role {
  return {
    id:           row.id,
    key:          row.key,
    display_name: row.display_name,
    description:  row.description,
    is_system:    row.is_system === 1,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  };
}

type PermissionRow = {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  category: string;
  is_system: number;
  created_at: string;
};

function rowToPermission(row: PermissionRow): Permission {
  return {
    id:           row.id,
    key:          row.key,
    display_name: row.display_name,
    description:  row.description,
    category:     row.category,
    is_system:    row.is_system === 1,
    created_at:   row.created_at,
  };
}

export class RolesDB {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<Role[]> {
    const rows = await this.db
      .prepare("SELECT * FROM roles ORDER BY is_system DESC, key ASC")
      .all<RoleRow>();
    return (rows.results ?? []).map(rowToRole);
  }

  async listWithPermissions(): Promise<RoleWithPermissions[]> {
    const roles = await this.list();
    const out: RoleWithPermissions[] = [];
    for (const r of roles) {
      const perms = await this.permissionsForRole(r.id);
      out.push({ ...r, permissions: perms });
    }
    return out;
  }

  async getById(id: string): Promise<Role | null> {
    const row = await this.db
      .prepare("SELECT * FROM roles WHERE id = ?1")
      .bind(id)
      .first<RoleRow>();
    return row ? rowToRole(row) : null;
  }

  async getByKey(key: string): Promise<Role | null> {
    const row = await this.db
      .prepare("SELECT * FROM roles WHERE key = ?1")
      .bind(key)
      .first<RoleRow>();
    return row ? rowToRole(row) : null;
  }

  async create(input: {
    key: string;
    display_name: string;
    description?: string | null;
    is_system?: boolean;
  }): Promise<Role> {
    const id  = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO roles (id, key, display_name, description, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`
      )
      .bind(
        id,
        input.key,
        input.display_name,
        input.description ?? null,
        input.is_system ? 1 : 0,
        now,
      )
      .run();
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    patch: Partial<{
      key: string;
      display_name: string;
      description: string | null;
    }>
  ): Promise<Role | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (patch.key !== undefined) {
      sets.push(`key = ?${vals.length + 1}`);
      vals.push(patch.key);
    }
    if (patch.display_name !== undefined) {
      sets.push(`display_name = ?${vals.length + 1}`);
      vals.push(patch.display_name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = ?${vals.length + 1}`);
      vals.push(patch.description);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = ?${vals.length + 1}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    await this.db
      .prepare(`UPDATE roles SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM roles WHERE id = ?1")
      .bind(id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async permissionsForRole(roleId: string): Promise<Permission[]> {
    const rows = await this.db
      .prepare(
        `SELECT p.*
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?1
         ORDER BY p.category ASC, p.key ASC`
      )
      .bind(roleId)
      .all<PermissionRow>();
    return (rows.results ?? []).map(rowToPermission);
  }

  async attachPermission(roleId: string, permissionId: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?1, ?2)`
      )
      .bind(roleId, permissionId)
      .run();
  }

  async detachPermission(roleId: string, permissionId: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `DELETE FROM role_permissions WHERE role_id = ?1 AND permission_id = ?2`
      )
      .bind(roleId, permissionId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  // ── User ↔ role assignments ──────────────────────────────────────────────

  async assignToUser(userId: string, roleId: string, assignedBy: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by, assigned_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(userId, roleId, assignedBy, new Date().toISOString())
      .run();
  }

  async revokeFromUser(userId: string, roleId: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM user_roles WHERE user_id = ?1 AND role_id = ?2")
      .bind(userId, roleId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}
