import { randomUUID } from "crypto";
import type {
  Tenant, TenantStatus, TenantPlan,
  Subscription, SubscriptionStatus,
  VerificationToken,
} from "./types.js";

// ─── Row shapes from D1 ───────────────────────────────────────────────────────

type VerificationTokenRow = {
  id: string;
  identifier: string;
  channel: string;
  code: string;
  expires_at: string;
  verified_at: string | null;
  attempt_count: number;
  created_at: string;
};

function rowToVerificationToken(row: VerificationTokenRow): VerificationToken {
  return {
    ...row,
    channel: row.channel as "email" | "sms",
  };
}

type TenantRow = {
  id: string;
  subdomain: string;
  store_name: string;
  plan: string;
  email: string;
  username: string | null;
  password_hash: string;
  status: string;
  cf_worker_name: string | null;
  cf_d1_id: string | null;
  cf_r2_bucket: string | null;
  cf_dns_record_id: string | null;
  cf_custom_domain_id: string | null;
  cf_route_id: string | null;
  payment_method_id: string | null;
  email_verified_at: string | null;
  phone_number: string | null;
  phone_verified_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: number;
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
    stripe_connect_onboarding_complete: row.stripe_connect_onboarding_complete === 1,
  };
}

// ─── TenantDB ─────────────────────────────────────────────────────────────────

export class TenantDB {
  constructor(private readonly db: D1Database) {}

  async createTenant(input: {
    subdomain: string;
    store_name: string;
    email: string;
    username: string;
    plan?: TenantPlan;
    payment_method_id: string;
    email_verified_at?: string;
  }): Promise<Tenant> {
    const id  = randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO tenants
           (id, subdomain, store_name, plan, email, username, password_hash, provisioning_data,
            status, payment_method_id, email_verified_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', NULL, 'provisioning', ?7, ?8, ?9, ?9)`
      )
      .bind(
        id,
        input.subdomain,
        input.store_name,
        input.plan ?? "starter",
        input.email.toLowerCase().trim(),
        input.username,
        input.payment_method_id,
        input.email_verified_at ?? null,
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

  /**
   * Case-insensitive email lookup. Used by the central /auth/login endpoint
   * to resolve a sign-in request to the tenant's store worker URL.
   */
  async getTenantByEmail(email: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare("SELECT * FROM tenants WHERE lower(email) = ?1 LIMIT 1")
      .bind(email.toLowerCase().trim())
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

  // ─── Verification token methods ─────────────────────────────────────────────

  async createVerificationToken(input: {
    identifier: string;
    channel: "email" | "sms";
    code: string;
    expiresAt: string;
  }): Promise<string> {
    const id  = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO verification_tokens (id, identifier, channel, code, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(id, input.identifier.toLowerCase().trim(), input.channel, input.code, input.expiresAt, now)
      .run();
    return id;
  }

  async getVerificationToken(id: string): Promise<VerificationToken | null> {
    const row = await this.db
      .prepare("SELECT * FROM verification_tokens WHERE id = ?1")
      .bind(id)
      .first<VerificationTokenRow>();
    return row ? rowToVerificationToken(row) : null;
  }

  /** Count how many OTP sends have occurred for this identifier within the window. */
  async countRecentSends(
    identifier: string,
    channel: string,
    windowMs: number
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM verification_tokens
         WHERE identifier = ?1 AND channel = ?2 AND created_at > ?3`
      )
      .bind(identifier.toLowerCase().trim(), channel, since)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async markVerified(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE verification_tokens SET verified_at = ?1 WHERE id = ?2")
      .bind(new Date().toISOString(), id)
      .run();
  }

  async incrementAttempts(id: string): Promise<number> {
    await this.db
      .prepare(
        "UPDATE verification_tokens SET attempt_count = attempt_count + 1 WHERE id = ?1"
      )
      .bind(id)
      .run();
    const row = await this.db
      .prepare("SELECT attempt_count FROM verification_tokens WHERE id = ?1")
      .bind(id)
      .first<{ attempt_count: number }>();
    return row?.attempt_count ?? 1;
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

  // ─── Subscription methods ──────────────────────────────────────────────────

  private rowToSubscription(row: Record<string, unknown>): Subscription {
    return {
      id:                     row.id as string,
      tenant_id:              row.tenant_id as string,
      plan:                   row.plan as TenantPlan,
      status:                 row.status as SubscriptionStatus,
      trial_ends_at:          row.trial_ends_at as string,
      current_period_end:     row.current_period_end as string | null,
      stripe_subscription_id: row.stripe_subscription_id as string | null,
      stripe_customer_id:     row.stripe_customer_id as string | null,
      payment_failed_at:      row.payment_failed_at as string | null,
      payment_failed_count:   row.payment_failed_count as number,
      reminder_30d_sent:      (row.reminder_30d_sent as number) === 1,
      reminder_7d_sent:       (row.reminder_7d_sent as number) === 1,
      reminder_1d_sent:       (row.reminder_1d_sent as number) === 1,
      expired_notice_sent:    (row.expired_notice_sent as number) === 1,
      created_at:             row.created_at as string,
      updated_at:             row.updated_at as string,
    };
  }

  async createSubscription(input: {
    tenantId: string;
    plan?: TenantPlan;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    trialEndsAt: string;
  }): Promise<Subscription> {
    const id  = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO subscriptions
           (id, tenant_id, plan, status, trial_ends_at, stripe_customer_id,
            stripe_subscription_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'trialing', ?4, ?5, ?6, ?7, ?7)`
      )
      .bind(
        id,
        input.tenantId,
        input.plan ?? "starter",
        input.trialEndsAt,
        input.stripeCustomerId,
        input.stripeSubscriptionId,
        now
      )
      .run();
    return (await this.getSubscriptionByTenantId(input.tenantId))!;
  }

  async getSubscriptionByTenantId(tenantId: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscriptions WHERE tenant_id = ?1")
      .bind(tenantId)
      .first<Record<string, unknown>>();
    return row ? this.rowToSubscription(row) : null;
  }

  async getSubscriptionByStripeCustomer(customerId: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscriptions WHERE stripe_customer_id = ?1")
      .bind(customerId)
      .first<Record<string, unknown>>();
    return row ? this.rowToSubscription(row) : null;
  }

  async updateSubscription(
    id: string,
    updates: Partial<{
      status: SubscriptionStatus;
      current_period_end: string;
      payment_failed_at: string | null;
      payment_failed_count: number;
    }>
  ): Promise<void> {
    const now  = new Date().toISOString();
    const sets = ["updated_at = ?1"];
    const vals: unknown[] = [now];

    if (updates.status              !== undefined) { sets.push(`status = ?${vals.length + 1}`);               vals.push(updates.status); }
    if (updates.current_period_end  !== undefined) { sets.push(`current_period_end = ?${vals.length + 1}`);   vals.push(updates.current_period_end); }
    if ("payment_failed_at" in updates)            { sets.push(`payment_failed_at = ?${vals.length + 1}`);    vals.push(updates.payment_failed_at ?? null); }
    if (updates.payment_failed_count !== undefined) { sets.push(`payment_failed_count = ?${vals.length + 1}`); vals.push(updates.payment_failed_count); }

    vals.push(id);
    await this.db
      .prepare(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
  }

  async markTrialReminderSent(id: string, type: "30d" | "7d" | "1d" | "expired"): Promise<void> {
    const col = type === "expired" ? "expired_notice_sent" : `reminder_${type}_sent`;
    await this.db
      .prepare(`UPDATE subscriptions SET ${col} = 1, updated_at = ?1 WHERE id = ?2`)
      .bind(new Date().toISOString(), id)
      .run();
  }

  /**
   * Returns subscriptions (with tenant email + store_name) that need a trial
   * reminder email sent today. A row is returned if any reminder window has
   * opened AND the corresponding flag is still 0.
   */
  async getSubscriptionsForTrialReminders(): Promise<
    Array<Subscription & { email: string; store_name: string }>
  > {
    const rows = await this.db
      .prepare(
        `SELECT s.*, t.email, t.store_name
         FROM subscriptions s
         JOIN tenants t ON t.id = s.tenant_id
         WHERE s.status IN ('trialing', 'active')
           AND (
             (s.trial_ends_at <= datetime('now', '+30 days') AND s.reminder_30d_sent = 0) OR
             (s.trial_ends_at <= datetime('now', '+7 days')  AND s.reminder_7d_sent  = 0) OR
             (s.trial_ends_at <= datetime('now', '+1 day')   AND s.reminder_1d_sent  = 0) OR
             (s.trial_ends_at <= datetime('now')             AND s.expired_notice_sent = 0)
           )`
      )
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(r => ({
      ...this.rowToSubscription(r),
      email:      r.email as string,
      store_name: r.store_name as string,
    }));
  }

  /**
   * Returns tenants that have been suspended for > 30 days (eligible for
   * permanent deprovision). Only returns those with an existing subscription
   * record so we have the payment_failed_at timestamp.
   */
  async getTenantsEligibleForDeprovision(): Promise<
    Array<Tenant & { payment_failed_at: string }>
  > {
    const rows = await this.db
      .prepare(
        `SELECT t.*, s.payment_failed_at
         FROM tenants t
         JOIN subscriptions s ON s.tenant_id = t.id
         WHERE t.status = 'suspended'
           AND s.payment_failed_at IS NOT NULL
           AND s.payment_failed_at <= datetime('now', '-30 days')`
      )
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(r => ({
      ...rowToTenant(r as TenantRow),
      payment_failed_at: r.payment_failed_at as string,
    }));
  }
}
