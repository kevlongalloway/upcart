// /subscriptions — list, read, change-plan, cancel, reactivate.
//
// All operations on Stripe go through src/stripe.ts. The local row in
// upcart-provisioning-db.subscriptions is treated as a cache: every change
// hits Stripe first and only persists once Stripe confirms.
//
// "Change plan" is the heaviest operation:
//   1. Look up the target SubscriptionPlan by id or key.
//   2. Tell Stripe to swap the price on the active subscription item.
//   3. On success, update the local row's plan + status + current_period_end.
//
// "Cancel" supports both immediate and end-of-period flavours.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, AuthedVariables, TenantPlan, SubscriptionStatus } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { StripeAPI } from "../stripe.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const subscriptionsRouter = new Hono<Env>();

const changePlanSchema = z.object({
  plan_id:  z.string().uuid().optional(),
  plan_key: z.string().min(1).max(50).optional(),
  prorate:  z.boolean().optional(),
}).refine(o => o.plan_id || o.plan_key, "Provide plan_id or plan_key.");

const cancelSchema = z.object({
  at_period_end: z.boolean().optional(),
});

// ─── List subscriptions ───────────────────────────────────────────────────────

subscriptionsRouter.get("/", requirePermissions("subscriptions.read"), async (c) => {
  const limit  = Math.min(Math.max(1, parseInt(c.req.query("limit")  ?? "50", 10) || 50), 200);
  const offset = Math.max(0,            parseInt(c.req.query("offset") ?? "0",  10) || 0);
  const status = c.req.query("status") ?? undefined;
  const plan   = c.req.query("plan")   ?? undefined;

  const db = new AdminDB(c.env);
  const { items, total } = await db.subscriptions.list({ limit, offset, status, plan });
  return c.json(ok({ items, total, limit, offset }));
});

// ─── Get subscription by id ───────────────────────────────────────────────────

subscriptionsRouter.get("/:id", requirePermissions("subscriptions.read"), async (c) => {
  const db  = new AdminDB(c.env);
  const sub = await db.subscriptions.getById(c.req.param("id"));
  if (!sub) return c.json(err("Subscription not found."), 404);
  return c.json(ok(sub));
});

// ─── Get subscription by tenant ───────────────────────────────────────────────

subscriptionsRouter.get(
  "/by-tenant/:tenant_id",
  requirePermissions("subscriptions.read"),
  async (c) => {
    const db  = new AdminDB(c.env);
    const sub = await db.subscriptions.getByTenantId(c.req.param("tenant_id"));
    if (!sub) return c.json(err("Subscription not found for tenant."), 404);
    return c.json(ok(sub));
  },
);

// ─── Change plan ──────────────────────────────────────────────────────────────

subscriptionsRouter.post(
  "/:id/change-plan",
  requirePermissions("subscriptions.update"),
  zValidator("json", changePlanSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("id");
    const body  = c.req.valid("json");
    const db    = new AdminDB(c.env);

    const sub = await db.subscriptions.getById(id);
    if (!sub) return c.json(err("Subscription not found."), 404);

    const plan = body.plan_id
      ? await db.plans.getById(body.plan_id)
      : await db.plans.getByKey(body.plan_key!);
    if (!plan) return c.json(err("Plan not found."), 404);
    if (!plan.active) return c.json(err("Plan is inactive."), 400);

    const previous_plan = sub.plan;

    // ── Stripe-backed path ─────────────────────────────────────────────────
    // Tenants without a stripe_subscription_id (admin-created provisions
    // without billing wired up) still get their local plan column updated;
    // they just don't trigger a Stripe call.
    if (sub.stripe_subscription_id) {
      if (!c.env.STRIPE_SECRET_KEY) {
        return c.json(err("STRIPE_SECRET_KEY not configured."), 503);
      }
      try {
        const stripe = new StripeAPI(c.env.STRIPE_SECRET_KEY);
        const result = await stripe.changeSubscriptionPrice(
          sub.stripe_subscription_id,
          plan.stripe_price_id,
          { prorate: body.prorate },
        );
        // Persist the new period end Stripe just gave us.
        const period_end = result.current_period_end
          ? new Date(result.current_period_end * 1000).toISOString()
          : sub.current_period_end;
        await db.subscriptions.update(id, {
          plan: plan.key as TenantPlan,
          status: mapStripeStatus(result.status),
          current_period_end: period_end,
        });
      } catch (e) {
        return c.json(err(`Stripe rejected the plan change: ${(e as Error).message}`), 502);
      }
    } else {
      // Local-only update (no Stripe subscription).
      await db.subscriptions.update(id, { plan: plan.key as TenantPlan });
    }

    // Mirror the new plan key on the tenants row so the rest of the
    // platform sees the change atomically.
    await db.provisions.update(sub.tenant_id, { plan: plan.key as TenantPlan });

    await audit(c, {
      action: "subscription.change_plan",
      resource_type: "subscription",
      resource_id: id,
      metadata: {
        tenant_id: sub.tenant_id,
        previous_plan,
        new_plan: plan.key,
        stripe_price_id: plan.stripe_price_id,
        prorate: body.prorate ?? true,
      },
    });

    const updated = await db.subscriptions.getById(id);
    return c.json(ok(updated));
  },
);

// ─── Cancel ──────────────────────────────────────────────────────────────────

subscriptionsRouter.post(
  "/:id/cancel",
  requirePermissions("subscriptions.cancel"),
  zValidator("json", cancelSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const db   = new AdminDB(c.env);

    const sub = await db.subscriptions.getById(id);
    if (!sub) return c.json(err("Subscription not found."), 404);

    if (sub.stripe_subscription_id) {
      if (!c.env.STRIPE_SECRET_KEY) {
        return c.json(err("STRIPE_SECRET_KEY not configured."), 503);
      }
      try {
        const stripe = new StripeAPI(c.env.STRIPE_SECRET_KEY);
        await stripe.cancelSubscription(sub.stripe_subscription_id, {
          at_period_end: body.at_period_end,
        });
      } catch (e) {
        return c.json(err(`Stripe cancel failed: ${(e as Error).message}`), 502);
      }
    }

    // Immediate cancel → mark cancelled now. Period-end cancel → leave
    // status as-is; the Stripe webhook in provisioning-service will move it
    // to "cancelled" once the period ends.
    if (!body.at_period_end) {
      await db.subscriptions.update(id, { status: "cancelled" });
    }

    await audit(c, {
      action: "subscription.cancel",
      resource_type: "subscription",
      resource_id: id,
      metadata: {
        tenant_id: sub.tenant_id,
        at_period_end: body.at_period_end ?? false,
      },
    });

    const updated = await db.subscriptions.getById(id);
    return c.json(ok(updated));
  },
);

// ─── Reactivate (undo a scheduled cancel-at-period-end) ──────────────────────

subscriptionsRouter.post(
  "/:id/reactivate",
  requirePermissions("subscriptions.cancel"),
  async (c) => {
    const id = c.req.param("id");
    const db = new AdminDB(c.env);

    const sub = await db.subscriptions.getById(id);
    if (!sub) return c.json(err("Subscription not found."), 404);

    if (!sub.stripe_subscription_id) {
      return c.json(err("Subscription is not linked to Stripe."), 400);
    }
    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json(err("STRIPE_SECRET_KEY not configured."), 503);
    }

    try {
      const stripe = new StripeAPI(c.env.STRIPE_SECRET_KEY);
      const result = await stripe.reactivateSubscription(sub.stripe_subscription_id);
      await db.subscriptions.update(id, { status: mapStripeStatus(result.status) });
    } catch (e) {
      return c.json(err(`Stripe reactivate failed: ${(e as Error).message}`), 502);
    }

    await audit(c, {
      action: "subscription.reactivate",
      resource_type: "subscription",
      resource_id: id,
      metadata: { tenant_id: sub.tenant_id },
    });

    const updated = await db.subscriptions.getById(id);
    return c.json(ok(updated));
  },
);

// ─── helpers ──────────────────────────────────────────────────────────────────

function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":           return "trialing";
    case "active":             return "active";
    case "past_due":
    case "unpaid":             return "payment_failed";
    case "paused":             return "suspended";
    case "canceled":
    case "incomplete_expired": return "cancelled";
    default:                   return "active";
  }
}
