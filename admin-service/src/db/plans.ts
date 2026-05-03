// CRUD over `subscription_plans` in PROVISIONING_DB. The table is the
// platform-wide catalogue of plans available at signup and during admin-
// driven plan changes. Each row maps a plan key (matching tenants.plan)
// to a Stripe Price ID.

import { randomUUID } from "crypto";
import type { SubscriptionPlan, BillingInterval } from "../types.js";

type PlanRow = {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  stripe_price_id: string;
  stripe_product_id: string | null;
  amount_cents: number;
  currency: string;
  interval: string;
  interval_count: number;
  active: number;
  is_default: number;
  trial_days: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function rowToPlan(row: PlanRow): SubscriptionPlan {
  return {
    id:                row.id,
    key:               row.key,
    display_name:      row.display_name,
    description:       row.description,
    stripe_price_id:   row.stripe_price_id,
    stripe_product_id: row.stripe_product_id,
    amount_cents:      row.amount_cents,
    currency:          row.currency,
    interval:          row.interval as BillingInterval,
    interval_count:    row.interval_count,
    active:            row.active === 1,
    is_default:        row.is_default === 1,
    trial_days:        row.trial_days,
    sort_order:        row.sort_order,
    created_at:        row.created_at,
    updated_at:        row.updated_at,
  };
}

export class PlansDB {
  constructor(private readonly db: D1Database) {}

  async list(opts: { active_only?: boolean } = {}): Promise<SubscriptionPlan[]> {
    const where  = opts.active_only ? "WHERE active = 1" : "";
    const rows = await this.db
      .prepare(
        `SELECT * FROM subscription_plans
         ${where}
         ORDER BY sort_order ASC, amount_cents ASC, key ASC`
      )
      .all<PlanRow>();
    return (rows.results ?? []).map(rowToPlan);
  }

  async getById(id: string): Promise<SubscriptionPlan | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscription_plans WHERE id = ?1")
      .bind(id)
      .first<PlanRow>();
    return row ? rowToPlan(row) : null;
  }

  async getByKey(key: string): Promise<SubscriptionPlan | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscription_plans WHERE key = ?1")
      .bind(key)
      .first<PlanRow>();
    return row ? rowToPlan(row) : null;
  }

  async getByStripePriceId(priceId: string): Promise<SubscriptionPlan | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscription_plans WHERE stripe_price_id = ?1")
      .bind(priceId)
      .first<PlanRow>();
    return row ? rowToPlan(row) : null;
  }

  async create(input: {
    key: string;
    display_name: string;
    description?: string | null;
    stripe_price_id: string;
    stripe_product_id?: string | null;
    amount_cents: number;
    currency: string;
    interval: BillingInterval;
    interval_count?: number;
    active?: boolean;
    is_default?: boolean;
    trial_days?: number;
    sort_order?: number;
  }): Promise<SubscriptionPlan> {
    const id  = randomUUID();
    const now = new Date().toISOString();

    if (input.is_default) await this.clearDefault();

    await this.db
      .prepare(
        `INSERT INTO subscription_plans
           (id, key, display_name, description,
            stripe_price_id, stripe_product_id,
            amount_cents, currency, interval, interval_count,
            active, is_default, trial_days, sort_order,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`
      )
      .bind(
        id,
        input.key,
        input.display_name,
        input.description ?? null,
        input.stripe_price_id,
        input.stripe_product_id ?? null,
        input.amount_cents,
        input.currency.toLowerCase(),
        input.interval,
        input.interval_count ?? 1,
        input.active === false ? 0 : 1,
        input.is_default ? 1 : 0,
        input.trial_days ?? 0,
        input.sort_order ?? 0,
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
      stripe_price_id: string;
      stripe_product_id: string | null;
      amount_cents: number;
      currency: string;
      interval: BillingInterval;
      interval_count: number;
      active: boolean;
      is_default: boolean;
      trial_days: number;
      sort_order: number;
    }>,
  ): Promise<SubscriptionPlan | null> {
    if (patch.is_default === true) await this.clearDefault(id);

    const sets: string[] = [];
    const vals: unknown[] = [];

    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?${vals.length + 1}`);
      vals.push(value);
    };

    if (patch.key               !== undefined) push("key",               patch.key);
    if (patch.display_name      !== undefined) push("display_name",      patch.display_name);
    if (patch.description       !== undefined) push("description",       patch.description);
    if (patch.stripe_price_id   !== undefined) push("stripe_price_id",   patch.stripe_price_id);
    if (patch.stripe_product_id !== undefined) push("stripe_product_id", patch.stripe_product_id);
    if (patch.amount_cents      !== undefined) push("amount_cents",      patch.amount_cents);
    if (patch.currency          !== undefined) push("currency",          patch.currency.toLowerCase());
    if (patch.interval          !== undefined) push("interval",          patch.interval);
    if (patch.interval_count    !== undefined) push("interval_count",    patch.interval_count);
    if (patch.active            !== undefined) push("active",            patch.active ? 1 : 0);
    if (patch.is_default        !== undefined) push("is_default",        patch.is_default ? 1 : 0);
    if (patch.trial_days        !== undefined) push("trial_days",        patch.trial_days);
    if (patch.sort_order        !== undefined) push("sort_order",        patch.sort_order);

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = ?${vals.length + 1}`);
    vals.push(new Date().toISOString());
    vals.push(id);

    await this.db
      .prepare(`UPDATE subscription_plans SET ${sets.join(", ")} WHERE id = ?${vals.length}`)
      .bind(...vals)
      .run();
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM subscription_plans WHERE id = ?1")
      .bind(id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /** Clear the is_default flag on every other plan, leaving `keepId` untouched. */
  private async clearDefault(keepId?: string): Promise<void> {
    if (keepId) {
      await this.db
        .prepare("UPDATE subscription_plans SET is_default = 0 WHERE id != ?1")
        .bind(keepId)
        .run();
    } else {
      await this.db
        .prepare("UPDATE subscription_plans SET is_default = 0")
        .run();
    }
  }
}
