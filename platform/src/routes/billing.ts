import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env, Variables } from "../types";
import { requireAuth } from "../middleware/auth";

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── GET /billing/plans (public) ───────────────────────────────────────────────

billing.get("/plans", async (c) => {
  const plans = await c.env.PLATFORM_DB
    .prepare("SELECT id, name, price_cents, features, sort_order FROM plans WHERE active = 1 ORDER BY sort_order ASC")
    .all<{ id: string; name: string; price_cents: number; features: string; sort_order: number }>();

  return c.json({
    plans: (plans.results ?? []).map(p => ({
      ...p,
      features: JSON.parse(p.features),
      price_display: p.price_cents === 0 ? "Free" : `$${(p.price_cents / 100).toFixed(2)}/mo`,
    })),
  });
});

// ── POST /billing/subscribe (protected) ───────────────────────────────────────
// Creates a Stripe Checkout Session for upgrading to a paid plan.
// Returns a redirect URL for the user to complete payment.

const subscribeSchema = z.object({
  plan_id:     z.enum(["basic", "pro"]),
  success_url: z.string().url(),
  cancel_url:  z.string().url(),
});

billing.post("/subscribe", requireAuth, zValidator("json", subscribeSchema), async (c) => {
  const { plan_id, success_url, cancel_url } = c.req.valid("json");
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const store = await db.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(store_id).first<{ id: string; stripe_customer_id: string | null; trial_ends_at: string; subscription_status: string }>();
  if (!store) return c.json({ error: "Store not found." }, 404);

  const plan = await db.prepare("SELECT * FROM plans WHERE id = ?")
    .bind(plan_id).first<{ id: string; stripe_price_id: string | null }>();
  if (!plan?.stripe_price_id) {
    return c.json({ error: "Stripe price not configured for this plan. Contact support." }, 503);
  }

  // Honour remaining trial time
  const trialEnd = new Date(store.trial_ends_at).getTime();
  const trialEndUnix = Math.floor(Math.max(trialEnd, Date.now()) / 1000);

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": plan.stripe_price_id,
    "line_items[0][quantity]": "1",
    success_url,
    cancel_url,
    "subscription_data[trial_end]": String(trialEndUnix),
    "subscription_data[metadata][store_id]": store.id,
    "subscription_data[metadata][plan_id]": plan_id,
  });
  if (store.stripe_customer_id) params.set("customer", store.stripe_customer_id);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!res.ok) {
    const err = await res.json() as { error: { message: string } };
    return c.json({ error: err.error?.message ?? "Failed to create checkout session." }, 502);
  }

  const session = await res.json() as { url: string; id: string };
  return c.json({ url: session.url, session_id: session.id });
});

// ── POST /billing/portal (protected) ─────────────────────────────────────────
// Opens the Stripe Customer Portal for managing payment method, invoices, etc.

const portalSchema = z.object({
  return_url: z.string().url(),
});

billing.post("/portal", requireAuth, zValidator("json", portalSchema), async (c) => {
  const { return_url } = c.req.valid("json");
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const store = await db.prepare("SELECT stripe_customer_id FROM stores WHERE id = ?")
    .bind(store_id).first<{ stripe_customer_id: string | null }>();

  if (!store?.stripe_customer_id) {
    return c.json({ error: "No billing account found. Please subscribe to a plan first." }, 400);
  }

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: store.stripe_customer_id,
      return_url,
    }),
  });

  if (!res.ok) return c.json({ error: "Failed to open billing portal." }, 502);
  const session = await res.json() as { url: string };
  return c.json({ url: session.url });
});

// ── POST /billing/webhooks/stripe (public — Stripe signed) ───────────────────

billing.post("/webhooks/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing Stripe signature." }, 400);

  const rawBody = await c.req.text();

  // Verify HMAC-SHA256 signature
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    const parts = Object.fromEntries(
      signature.split(",").map(p => { const [k, v] = p.split("="); return [k, v]; })
    );
    const ts = parts["t"];
    const sig = parts["v1"];
    if (!ts || !sig) throw new Error("Malformed signature header.");
    if (Math.abs(Date.now() / 1000 - parseInt(ts, 10)) > 300) throw new Error("Timestamp expired.");

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(c.env.STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${ts}.${rawBody}`));
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Constant-time string comparison
    if (expected.length !== sig.length) throw new Error("Signature mismatch.");
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) throw new Error("Signature mismatch.");

    event = JSON.parse(rawBody);
  } catch (err) {
    return c.json({ error: "Webhook verification failed." }, 400);
  }

  const db = c.env.PLATFORM_DB;
  const now = new Date().toISOString();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as { id: string; status: string; current_period_end: number; metadata: Record<string, string> };
      const storeId = sub.metadata?.store_id;
      if (storeId) {
        await db.prepare(`
          UPDATE stores SET
            stripe_subscription_id = ?,
            subscription_status = ?,
            plan_id = ?,
            subscription_current_period_end = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
          sub.id,
          sub.status,
          sub.metadata?.plan_id ?? "basic",
          new Date(sub.current_period_end * 1000).toISOString(),
          now,
          storeId
        ).run();
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as { metadata: Record<string, string> };
      const storeId = sub.metadata?.store_id;
      if (storeId) {
        await db.prepare("UPDATE stores SET subscription_status = 'canceled', plan_id = 'trial', updated_at = ? WHERE id = ?")
          .bind(now, storeId).run();
      }
      break;
    }

    case "invoice.payment_failed": {
      const inv = event.data.object as { customer: string };
      await db.prepare("UPDATE stores SET subscription_status = 'past_due', updated_at = ? WHERE stripe_customer_id = ?")
        .bind(now, inv.customer).run();
      break;
    }

    case "invoice.payment_succeeded": {
      const inv = event.data.object as { customer: string; subscription: string | null };
      if (inv.subscription) {
        await db.prepare("UPDATE stores SET subscription_status = 'active', updated_at = ? WHERE stripe_customer_id = ?")
          .bind(now, inv.customer).run();
      }
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object as { mode: string; customer: string; metadata: Record<string, string> };
      if (session.mode === "subscription") {
        const storeId = session.metadata?.store_id;
        if (storeId) {
          await db.prepare("UPDATE stores SET stripe_customer_id = COALESCE(stripe_customer_id, ?), subscription_status = 'active', updated_at = ? WHERE id = ?")
            .bind(session.customer, now, storeId).run();
        }
      }
      break;
    }
  }

  return c.json({ received: true });
});

export default billing;
