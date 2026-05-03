// Read/update accessors over the `subscriptions` table in PROVISIONING_DB.
// The table itself is owned by provisioning-service migrations 0008 — we
// surface the columns the admin portal needs.

import type { Subscription, SubscriptionStatus, TenantPlan } from "../types.js";

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan: string;
  status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  payment_failed_at: string | null;
  payment_failed_count: number;
  created_at: string;
  updated_at: string;
};

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id:                     row.id,
    tenant_id:              row.tenant_id,
    plan:                   row.plan as TenantPlan,
    status:                 row.status as SubscriptionStatus,
    trial_ends_at:          row.trial_ends_at,
    current_period_end:     row.current_period_end,
    stripe_subscription_id: row.stripe_subscription_id,
    stripe_customer_id:     row.stripe_customer_id,
    payment_failed_at:      row.payment_failed_at,
    payment_failed_count:   row.payment_failed_count,
    created_at:             row.created_at,
    updated_at:             row.updated_at,
  };
}

const SUB_COLS =
  `id, tenant_id, plan, status, trial_ends_at, current_period_end,
   stripe_subscription_id, stripe_customer_id,
   payment_failed_at, payment_failed_count,
   created_at, updated_at`;

export type SubscriptionWithTenant = Subscription & {
  tenant: {
    id: string;
    subdomain: string;
    store_name: string;
    email: string;
    status: string;
  };
};

export class SubscriptionsDB {
  constructor(private readonly db: D1Database) {}

  async list(opts: {
    limit: number;
    offset: number;
    status?: string;
    plan?: string;
  }): Promise<{ items: SubscriptionWithTenant[]; total: number }> {
    const where: string[] = [];
    const vals: unknown[] = [];

    if (opts.status) {
      where.push(`s.status = ?${vals.length + 1}`);
      vals.push(opts.status);
    }
    if (opts.plan) {
      where.push(`s.plan = ?${vals.length + 1}`);
      vals.push(opts.plan);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM subscriptions s ${whereClause}`)
      .bind(...vals)
      .first<{ n: number }>();

    const rows = await this.db
      .prepare(
        `SELECT
           s.id, s.tenant_id, s.plan, s.status, s.trial_ends_at, s.current_period_end,
           s.stripe_subscription_id, s.stripe_customer_id,
           s.payment_failed_at, s.payment_failed_count,
           s.created_at, s.updated_at,
           t.subdomain, t.store_name, t.email, t.status AS tenant_status
         FROM subscriptions s
         JOIN tenants t ON t.id = s.tenant_id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT ?${vals.length + 1} OFFSET ?${vals.length + 2}`
      )
      .bind(...vals, opts.limit, opts.offset)
      .all<SubscriptionRow & {
        subdomain: string;
        store_name: string;
        email: string;
        tenant_status: string;
      }>();

    const items: SubscriptionWithTenant[] = (rows.results ?? []).map(r => ({
      ...rowToSubscription(r),
      tenant: {
        id:         r.tenant_id,
        subdomain:  r.subdomain,
        store_name: r.store_name,
        email:      r.email,
        status:     r.tenant_status,
      },
    }));

    return { items, total: totalRow?.n ?? 0 };
  }

  async getById(id: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare(`SELECT ${SUB_COLS} FROM subscriptions WHERE id = ?1`)
      .bind(id)
      .first<SubscriptionRow>();
    return row ? rowToSubscription(row) : null;
  }

  async getByTenantId(tenantId: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare(`SELECT ${SUB_COLS} FROM subscriptions WHERE tenant_id = ?1`)
      .bind(tenantId)
      .first<SubscriptionRow>();
    return row ? rowToSubscription(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      plan: TenantPlan;
      status: SubscriptionStatus;
      current_period_end: string | null;
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
      payment_failed_at: string | null;
      payment_failed_count: number;
    }>,
  ): Promise<Subscription | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?${vals.length + 1}`);
      vals.push(value);
    };

    if (patch.plan                   !== undefined) push("plan",                   patch.plan);
    if (patch.status                 !== undefined) push("status",                 patch.status);
    if (patch.current_period_end     !== undefined) push("current_period_end",     patch.current_period_end);
    if (patch.stripe_subscription_id !== undefined) push("stripe_subscription_id", patch.stripe_subscription_id);
    if (patch.stripe_customer_id     !== undefined) push("stripe_customer_id",     patch.stripe_customer_id);
    if (patch.payment_failed_at      !== undefined) push("payment_failed_at",      patch.payment_failed_at);
    if (patch.payment_failed_count   !== undefined) push("payment_failed_count",   patch.payment_failed_count);

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = ?${vals.length + 1}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    await this.db
      .prepare(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }
}
