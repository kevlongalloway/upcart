// Admin-user CRUD against the `admin_users` table in `upcart-admin-db`.
// Used by routes/users.ts and the auth flow.

import { randomUUID } from "crypto";
import type {
  AdminUser, AdminUserStatus, AdminUserWithAccess, Role, Permission,
} from "../types.js";

type AdminUserRow = {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  full_name: string | null;
  status: string;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToUser(row: AdminUserRow): AdminUser {
  return {
    id:            row.id,
    email:         row.email,
    username:      row.username,
    full_name:     row.full_name,
    status:        row.status as AdminUserStatus,
    last_login_at: row.last_login_at,
    created_by:    row.created_by,
    created_at:    row.created_at,
    updated_at:    row.updated_at,
  };
}

export class UsersDB {
  constructor(private readonly db: D1Database) {}

  async countActive(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM admin_users")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async list(opts: { limit: number; offset: number }): Promise<AdminUser[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, email, username, password_hash, full_name, status, last_login_at,
                created_by, created_at, updated_at
         FROM admin_users
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2`
      )
      .bind(opts.limit, opts.offset)
      .all<AdminUserRow>();
    return (rows.results ?? []).map(rowToUser);
  }

  async getById(id: string): Promise<AdminUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM admin_users WHERE id = ?1")
      .bind(id)
      .first<AdminUserRow>();
    return row ? rowToUser(row) : null;
  }

  async getByEmail(email: string): Promise<(AdminUser & { password_hash: string }) | null> {
    const row = await this.db
      .prepare("SELECT * FROM admin_users WHERE lower(email) = ?1 LIMIT 1")
      .bind(email.toLowerCase().trim())
      .first<AdminUserRow>();
    if (!row) return null;
    return { ...rowToUser(row), password_hash: row.password_hash };
  }

  async getByUsername(username: string): Promise<AdminUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM admin_users WHERE lower(username) = ?1 LIMIT 1")
      .bind(username.toLowerCase().trim())
      .first<AdminUserRow>();
    return row ? rowToUser(row) : null;
  }

  async create(input: {
    email: string;
    username: string;
    password_hash: string;
    full_name?: string | null;
    status?: AdminUserStatus;
    created_by?: string | null;
    id?: string;
  }): Promise<AdminUser> {
    const id  = input.id ?? randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO admin_users
           (id, email, username, password_hash, full_name, status, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
      )
      .bind(
        id,
        input.email.toLowerCase().trim(),
        input.username,
        input.password_hash,
        input.full_name ?? null,
        input.status ?? "active",
        input.created_by ?? null,
        now,
      )
      .run();
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    patch: Partial<{
      email: string;
      username: string;
      password_hash: string;
      full_name: string | null;
      status: AdminUserStatus;
    }>
  ): Promise<AdminUser | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (patch.email !== undefined) {
      sets.push(`email = ?${vals.length + 1}`);
      vals.push(patch.email.toLowerCase().trim());
    }
    if (patch.username !== undefined) {
      sets.push(`username = ?${vals.length + 1}`);
      vals.push(patch.username);
    }
    if (patch.password_hash !== undefined) {
      sets.push(`password_hash = ?${vals.length + 1}`);
      vals.push(patch.password_hash);
    }
    if (patch.full_name !== undefined) {
      sets.push(`full_name = ?${vals.length + 1}`);
      vals.push(patch.full_name);
    }
    if (patch.status !== undefined) {
      sets.push(`status = ?${vals.length + 1}`);
      vals.push(patch.status);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = ?${vals.length + 1}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    await this.db
      .prepare(`UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM admin_users WHERE id = ?1")
      .bind(id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async touchLastLogin(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare("UPDATE admin_users SET last_login_at = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(now, now, id)
      .run();
  }

  /**
   * Hydrate a user with their roles + flat permission keys. The wildcard
   * permission "*" is included verbatim so the permission middleware can
   * short-circuit superadmin checks without hitting the table again.
   */
  async getWithAccess(id: string): Promise<AdminUserWithAccess | null> {
    const user = await this.getById(id);
    if (!user) return null;

    const roleRows = await this.db
      .prepare(
        `SELECT r.id, r.key, r.display_name, r.description, r.is_system, r.created_at, r.updated_at
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?1
         ORDER BY r.key ASC`
      )
      .bind(id)
      .all<{
        id: string; key: string; display_name: string;
        description: string | null; is_system: number;
        created_at: string; updated_at: string;
      }>();

    const roles: Role[] = (roleRows.results ?? []).map(r => ({
      id:           r.id,
      key:          r.key,
      display_name: r.display_name,
      description:  r.description,
      is_system:    r.is_system === 1,
      created_at:   r.created_at,
      updated_at:   r.updated_at,
    }));

    const permRows = await this.db
      .prepare(
        `SELECT DISTINCT p.key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p       ON p.id       = rp.permission_id
         WHERE ur.user_id = ?1`
      )
      .bind(id)
      .all<{ key: string }>();

    const permissions = (permRows.results ?? []).map(p => p.key);

    return { ...user, roles, permissions };
  }
}

// Re-export Permission/Role for callers that import everything from db/users.
export type { Role, Permission };
