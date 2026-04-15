import { randomUUID } from "crypto";
import type { Tenant, TenantStatus, TenantPlan } from "./types.js";

// ─── Row shape from D1 ────────────────────────────────────────────────────────

type TenantRow = {
  id: string;
  subdomain: string;
  store_name: string;
  plan: string;
  email: string;
  password_hash: string;
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
    ...row,
    plan: row.plan as TenantPlan,
    status: row.status as TenantStatus,
  };
}

// ─── TenantDB ─────────────────────────────────────────────────────────────────

export class TenantDB {
  constructor(private readonly db: D1Database) {}

  async createTenant(input: {
    subdomain: string;
    store_name: string;
    email: string;
    password_hash: string;
    plan?: TenantPlan;
  }): Promise<Tenant> {
    const id  = randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO tenants
           (id, subdomain, store_name, plan, email, password_hash, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'provisioning', ?7, ?7)`
      )
      .bind(
        id,
        input.subdomain,
        input.store_name,
        input.plan ?? "starter",
        input.email,
        input.password_hash,
        now
      )
      .run();

    return (await this.getTenant(id))!;
  }

  async getTenant(id: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare("SELECT * FROM tenants WHERE id = ?1")
      .bind(id)
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare("SELECT * FROM tenants WHERE subdomain = ?1")
      .bind(subdomain.toLowerCase())
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }

  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT id FROM tenants WHERE subdomain = ?1")
      .bind(subdomain.toLowerCase())
      .first<{ id: string }>();
    return row === null;
  }

  async updateStatus(
    id: string,
    status: TenantStatus,
    errorMessage?: string
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tenants
         SET status = ?1, error_message = ?2, updated_at = ?3
         WHERE id = ?4`
      )
      .bind(status, errorMessage ?? null, new Date().toISOString(), id)
      .run();
  }

  /**
   * Persist Cloudflare resource IDs and live URLs as they are created during
   * provisioning.  Only the fields present in `resources` are updated — all
   * other columns are left unchanged.
   */
  async updateResources(
    id: string,
    resources: {
      cf_worker_name?: string;
      cf_d1_id?: string;
      cf_r2_bucket?: string;
      cf_dns_record_id?: string;
      cf_custom_domain_id?: string;
      cf_route_id?: string;
      store_url?: string;
      admin_url?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?1"];
    const bindings: unknown[] = [now];

    const fields: Array<keyof typeof resources> = [
      "cf_worker_name",
      "cf_d1_id",
      "cf_r2_bucket",
      "cf_dns_record_id",
      "cf_custom_domain_id",
      "cf_route_id",
      "store_url",
      "admin_url",
    ];

    for (const field of fields) {
      if (resources[field] !== undefined) {
        sets.push(`${field} = ?${bindings.length + 1}`);
        bindings.push(resources[field] as string);
      }
    }

    bindings.push(id);
    await this.db
      .prepare(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?${bindings.length}`)
      .bind(...bindings)
      .run();
  }
}
