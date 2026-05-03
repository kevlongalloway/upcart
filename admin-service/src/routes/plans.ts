// /plans — CRUD over the subscription plan catalogue.
//
// Each row maps an internal plan key (e.g. "starter") to a Stripe Price ID.
// On create/update the service can optionally retrieve the price from
// Stripe to denormalise amount/currency/interval — saving the operator
// from typing them by hand and keeping the local cache honest.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, AuthedVariables, BillingInterval } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { StripeAPI } from "../stripe.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const plansRouter = new Hono<Env>();

const PLAN_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;
const INTERVALS = ["day", "week", "month", "year"] as const satisfies readonly BillingInterval[];

const createSchema = z.object({
  key:               z.string().regex(PLAN_KEY_RE),
  display_name:      z.string().min(1).max(120),
  description:       z.string().max(500).optional(),
  stripe_price_id:   z.string().min(1).max(120),
  // The next four are optional — if omitted we fetch them from Stripe.
  amount_cents:      z.number().int().nonnegative().optional(),
  currency:          z.string().length(3).optional(),
  interval:          z.enum(INTERVALS).optional(),
  interval_count:    z.number().int().positive().optional(),
  active:            z.boolean().optional(),
  is_default:        z.boolean().optional(),
  trial_days:        z.number().int().nonnegative().max(365).optional(),
  sort_order:        z.number().int().optional(),
});

const updateSchema = z.object({
  key:               z.string().regex(PLAN_KEY_RE).optional(),
  display_name:      z.string().min(1).max(120).optional(),
  description:       z.string().max(500).nullable().optional(),
  stripe_price_id:   z.string().min(1).max(120).optional(),
  amount_cents:      z.number().int().nonnegative().optional(),
  currency:          z.string().length(3).optional(),
  interval:          z.enum(INTERVALS).optional(),
  interval_count:    z.number().int().positive().optional(),
  active:            z.boolean().optional(),
  is_default:        z.boolean().optional(),
  trial_days:        z.number().int().nonnegative().max(365).optional(),
  sort_order:        z.number().int().optional(),
}).refine(o => Object.keys(o).length > 0, "At least one field is required.");

// ─── List plans ───────────────────────────────────────────────────────────────

plansRouter.get("/", requirePermissions("plans.read"), async (c) => {
  const activeOnly = c.req.query("active_only") === "true";
  const db = new AdminDB(c.env);
  const items = await db.plans.list({ active_only: activeOnly });
  return c.json(ok({ items }));
});

// ─── Get plan ─────────────────────────────────────────────────────────────────

plansRouter.get("/:id", requirePermissions("plans.read"), async (c) => {
  const db = new AdminDB(c.env);
  const plan = await db.plans.getById(c.req.param("id"));
  if (!plan) return c.json(err("Plan not found."), 404);
  return c.json(ok(plan));
});

// ─── Create plan ──────────────────────────────────────────────────────────────

plansRouter.post(
  "/",
  requirePermissions("plans.create"),
  zValidator("json", createSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db    = new AdminDB(c.env);

    if (await db.plans.getByKey(input.key)) {
      return c.json(err("A plan with this key already exists."), 409);
    }
    if (await db.plans.getByStripePriceId(input.stripe_price_id)) {
      return c.json(err("A plan with this Stripe price ID already exists."), 409);
    }

    // Fill in missing money fields from Stripe when STRIPE_SECRET_KEY is set.
    let amount_cents     = input.amount_cents;
    let currency         = input.currency;
    let interval         = input.interval;
    let interval_count   = input.interval_count;
    let stripe_product_id: string | null = null;

    if (c.env.STRIPE_SECRET_KEY) {
      try {
        const price = await new StripeAPI(c.env.STRIPE_SECRET_KEY)
          .retrievePrice(input.stripe_price_id);
        amount_cents     = amount_cents     ?? price.unit_amount ?? 0;
        currency         = currency         ?? price.currency;
        interval         = interval         ?? (price.recurring?.interval ?? "month");
        interval_count   = interval_count   ?? (price.recurring?.interval_count ?? 1);
        stripe_product_id = price.product;
      } catch (e) {
        return c.json(
          err(`Could not retrieve Stripe price: ${(e as Error).message}`),
          400,
        );
      }
    }

    if (amount_cents === undefined || !currency || !interval) {
      return c.json(
        err("Missing amount/currency/interval — provide them or configure STRIPE_SECRET_KEY."),
        400,
      );
    }

    const plan = await db.plans.create({
      key:               input.key,
      display_name:      input.display_name,
      description:       input.description ?? null,
      stripe_price_id:   input.stripe_price_id,
      stripe_product_id,
      amount_cents,
      currency,
      interval,
      interval_count:    interval_count ?? 1,
      active:            input.active ?? true,
      is_default:        input.is_default ?? false,
      trial_days:        input.trial_days ?? 0,
      sort_order:        input.sort_order ?? 0,
    });

    await audit(c, {
      action: "plan.create",
      resource_type: "plan",
      resource_id: plan.id,
      metadata: { key: plan.key, stripe_price_id: plan.stripe_price_id },
    });

    return c.json(ok(plan), 201);
  },
);

// ─── Update plan ──────────────────────────────────────────────────────────────

plansRouter.patch(
  "/:id",
  requirePermissions("plans.update"),
  zValidator("json", updateSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("id");
    const patch = c.req.valid("json");
    const db    = new AdminDB(c.env);

    const existing = await db.plans.getById(id);
    if (!existing) return c.json(err("Plan not found."), 404);

    // Refuse key/price collisions with another row.
    if (patch.key && patch.key !== existing.key) {
      const other = await db.plans.getByKey(patch.key);
      if (other && other.id !== id) return c.json(err("Plan key already in use."), 409);
    }
    if (patch.stripe_price_id && patch.stripe_price_id !== existing.stripe_price_id) {
      const other = await db.plans.getByStripePriceId(patch.stripe_price_id);
      if (other && other.id !== id) return c.json(err("Stripe price ID already in use."), 409);

      // Refresh denormalised money fields from Stripe whenever the price ID
      // changes — operators don't have to re-enter them.
      if (c.env.STRIPE_SECRET_KEY) {
        try {
          const price = await new StripeAPI(c.env.STRIPE_SECRET_KEY)
            .retrievePrice(patch.stripe_price_id);
          if (patch.amount_cents   === undefined) patch.amount_cents   = price.unit_amount ?? 0;
          if (patch.currency       === undefined) patch.currency       = price.currency;
          if (patch.interval       === undefined) patch.interval       = price.recurring?.interval ?? "month";
          if (patch.interval_count === undefined) patch.interval_count = price.recurring?.interval_count ?? 1;
        } catch (e) {
          return c.json(err(`Could not retrieve Stripe price: ${(e as Error).message}`), 400);
        }
      }
    }

    const updated = await db.plans.update(id, patch);

    await audit(c, {
      action: "plan.update",
      resource_type: "plan",
      resource_id: id,
      metadata: { fields: Object.keys(patch) },
    });

    return c.json(ok(updated));
  },
);

// ─── Delete plan ──────────────────────────────────────────────────────────────

plansRouter.delete("/:id", requirePermissions("plans.delete"), async (c) => {
  const id = c.req.param("id");
  const db = new AdminDB(c.env);

  const existing = await db.plans.getById(id);
  if (!existing) return c.json(err("Plan not found."), 404);

  await db.plans.delete(id);

  await audit(c, {
    action: "plan.delete",
    resource_type: "plan",
    resource_id: id,
    metadata: { key: existing.key },
  });

  return c.json(ok({ deleted: true }));
});
