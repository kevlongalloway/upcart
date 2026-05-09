// Permission catalogue CRUD against the upcart-admin-db.

import { randomUUID } from "crypto";
import type { Permission } from "../types.js";

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

export class PermissionsDB {
  constructor(private readonly db: D1Database) {}

  async list(opts: { category?: string } = {}): Promise<Permission[]> {
    let stmt;
    if (opts.category) {
      stmt = this.db
        .prepare("SELECT * FROM permissions WHERE category = ?1 ORDER BY key ASC")
        .bind(opts.category);
    } else {
      stmt = this.db.prepare(
        "SELECT * FROM permissions ORDER BY category ASC, key ASC"
      );
    }
    const rows = await stmt.all<PermissionRow>();
    return (rows.results ?? []).map(rowToPermission);
  }

  async getById(id: string): Promise<Permission | null> {
    const row = await this.db
      .prepare("SELECT * FROM permissions WHERE id = ?1")
      .bind(id)
      .first<PermissionRow>();
    return row ? rowToPermission(row) : null;
  }

  async getByKey(key: string): Promise<Permission | null> {
    const row = await this.db
      .prepare("SELECT * FROM permissions WHERE key = ?1")
      .bind(key)
      .first<PermissionRow>();
    return row ? rowToPermission(row) : null;
  }

  async create(input: {
    key: string;
    display_name: string;
    description?: string | null;
    category: string;
    is_system?: boolean;
  }): Promise<Permission> {
    const id  = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO permissions
           (id, key, display_name, description, category, is_system, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        id,
        input.key,
        input.display_name,
        input.description ?? null,
        input.category,
        input.is_system ? 1 : 0,
        now,
      )
      .run();
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    patch: Partial<{
      display_name: string;
      description: string | null;
      category: string;
    }>
  ): Promise<Permission | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (patch.display_name !== undefined) {
      sets.push(`display_name = ?${vals.length + 1}`);
      vals.push(patch.display_name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = ?${vals.length + 1}`);
      vals.push(patch.description);
    }
    if (patch.category !== undefined) {
      sets.push(`category = ?${vals.length + 1}`);
      vals.push(patch.category);
    }

    if (sets.length === 0) return this.getById(id);

    vals.push(id);
    await this.db
      .prepare(`UPDATE permissions SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM permissions WHERE id = ?1")
      .bind(id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}
