// Cross-DB accessor for the provisioning-service's `tenants` table.
//
// Bound as `PROVISIONING_DB` in wrangler.toml. The schema mirrored here is
// owned by provisioning-service/migrations/0001_create_tenants.sql + 0005,
// 0006, 0009. We only surface the subset of columns the admin portal needs
// — adding new fields is a matter of extending the row mapper.

import { randomUUID } from "crypto";
import type { Tenant, TenantStatus, TenantPlan } from "../types.js";

type TenantRow = {
  id: string;
  subdomain: string;
  store_name: string;
  plan: string;
  email: string;
  username: string | null;
  status: string;
  cf_worker_name: string | null;
  cf_d1_id: string | null;
  cf_r2_bucket: string | null;
  cf_dns_record_id: string | null;
  cf_custom_domain_id: string | null;
  cf_route_id: string | null;
  store_url: string | null;
  admin_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function rowToTenant(row: TenantRow): Tenant {
  return {
    id:                  row.id,
    subdomain:           row.subdomain,
    store_name:          row.store_name,
    plan:                row.plan as TenantPlan,
    email:               row.email,
    username:            row.username,
    status:              row.status as TenantStatus,
    cf_worker_name:      row.cf_worker_name,
    cf_d1_id:            row.cf_d1_id,
    cf_r2_bucket:        row.cf_r2_bucket,
    cf_dns_record_id:    row.cf_dns_record_id,
    cf_custom_domain_id: row.cf_custom_domain_id,
    cf_route_id:         row.cf_route_id,
    store_url:           row.store_url,
    admin_url:           row.admin_url,
    error_message:       row.error_message,
    created_at:          row.created_at,
    updated_at:          row.updated_at,
  };
}

const TENANT_COLS =
  `id, subdomain, store_name, plan, email, username, status,
   cf_worker_name, cf_d1_id, cf_r2_bucket,
   cf_dns_record_id, cf_custom_domain_id, cf_route_id,
   store_url, admin_url, error_message, created_at, updated_at`;

export class ProvisionsDB {
  constructor(private readonly db: D1Database) {}

  async list(opts: {
    limit: number;
    offset: number;
    status?: string;
    plan?: string;
    search?: string;
  }): Promise<{ items: Tenant[]; total: number }> {
    const where: string[] = [];
    const vals: unknown[] = [];

    if (opts.status) {
      where.push(`status = ?${vals.length + 1}`);
      vals.push(opts.status);
    }
    if (opts.plan) {
      where.push(`plan = ?${vals.length + 1}`);
      vals.push(opts.plan);
    }
    if (opts.search) {
      const term = `%${opts.search.toLowerCase()}%`;
      where.push(`(lower(store_name) LIKE ?${vals.length + 1}
                   OR lower(subdomain) LIKE ?${vals.length + 1}
                   OR lower(email)     LIKE ?${vals.length + 1})`);
      vals.push(term);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM tenants ${whereClause}`)
      .bind(...vals)
      .first<{ n: number }>();

    const rows = await this.db
      .prepare(
        `SELECT ${TENANT_COLS} FROM tenants
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ?${vals.length + 1} OFFSET ?${vals.length + 2}`
      )
      .bind(...vals, opts.limit, opts.offset)
      .all<TenantRow>();

    return {
      items: (rows.results ?? []).map(rowToTenant),
      total: totalRow?.n ?? 0,
    };
  }

  async getById(id: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE id = ?1`)
      .bind(id)
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }

  async getBySubdomain(subdomain: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE subdomain = ?1`)
      .bind(subdomain.toLowerCase())
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      store_name: string;
      plan: TenantPlan;
      status: TenantStatus;
      error_message: string | null;
      cf_worker_name: string;
      cf_d1_id: string;
      cf_r2_bucket: string;
      cf_dns_record_id: string;
      cf_custom_domain_id: string;
      cf_route_id: string;
      store_url: string;
      admin_url: string;
    }>
  ): Promise<Tenant | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    const fields = [
      "store_name", "plan", "status", "error_message",
      "cf_worker_name", "cf_d1_id", "cf_r2_bucket",
      "cf_dns_record_id", "cf_custom_domain_id", "cf_route_id",
      "store_url", "admin_url",
    ] as const;

    for (const field of fields) {
      if (patch[field] !== undefined) {
        sets.push(`${field} = ?${vals.length + 1}`);
        vals.push(patch[field] as unknown);
      }
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = ?${vals.length + 1}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    await this.db
      .prepare(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }

  /**
   * Insert a new tenant row in the provisioning-managed shape. Used by
   * admin-create after the CF resources have been allocated. Mirrors the
   * minimum NOT NULL set defined in provisioning-service migrations.
   */
  async insertAdminCreated(input: {
    id?: string;
    subdomain: string;
    store_name: string;
    plan: TenantPlan;
    email: string;
    username: string;
    password_hash: string;
    payment_method_id: string | null;
  }): Promise<string> {
    const id  = input.id ?? randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO tenants
           (id, subdomain, store_name, plan, email, username, password_hash,
            provisioning_data, status, payment_method_id,
            email_verified_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'provisioning', ?8, ?9, ?9, ?9)`
      )
      .bind(
        id,
        input.subdomain.toLowerCase(),
        input.store_name,
        input.plan,
        input.email.toLowerCase().trim(),
        input.username,
        input.password_hash,
        input.payment_method_id ?? "admin_manual",
        now,
      )
      .run();
    return id;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM tenants WHERE id = ?1")
      .bind(id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT id FROM tenants WHERE subdomain = ?1")
      .bind(subdomain.toLowerCase())
      .first<{ id: string }>();
    return row === null;
  }
}
