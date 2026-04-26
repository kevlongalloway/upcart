// Stripe platform webhook handler — POST /webhooks/stripe
//
// Handles subscription lifecycle events for the platform account:
//   invoice.payment_failed  → increment failure count; suspend after 3 failures
//                              or 7 days since first failure (whichever comes first)
//   invoice.paid            → restore active status + worker on payment recovery
//   customer.subscription.* → sync subscription status changes from Stripe

import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { TenantDB } from "../db.js";
import { CloudflareAPI } from "../cloudflare-api.js";
import {
  sendPaymentFailedEmail,
  sendStoreSuspendedEmail,
  sendPaymentRecoveredEmail,
} from "../email.js";

// ─── Stripe signature verification ───────────────────────────────────────────

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSec = 300
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const chunk of header.split(",")) {
    const eq = chunk.indexOf("=");
    if (eq !== -1) parts[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > toleranceSec) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === signature;
}

// ─── Suspension helpers ───────────────────────────────────────────────────────

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const MAX_FAILURES    = 3;

async function suspendTenant(
  env: Bindings,
  tenantId: string,
  tenantEmail: string,
  storeName: string,
  db: TenantDB
): Promise<void> {
  const workerName  = `${env.WORKER_SCRIPT_PREFIX}-${tenantId}`;
  const dashboardUrl = `https://dashboard.${env.BASE_DOMAIN}`;

  // 1. Flip the TENANT_STATUS secret on the worker — takes effect immediately
  const cf = new CloudflareAPI(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
  try {
    await cf.setWorkerSecret(workerName, "TENANT_STATUS", "suspended");
  } catch (e) {
    console.error(`webhooks: failed to set TENANT_STATUS for ${tenantId}:`, e);
  }

  // 2. Update tenant + subscription in DB
  await db.updateStatus(tenantId, "suspended");
  const sub = await db.getSubscriptionByTenantId(tenantId);
  if (sub) await db.updateSubscription(sub.id, { status: "suspended" });

  // 3. Notify merchant
  if (env.RESEND_API_KEY) {
    try {
      await sendStoreSuspendedEmail(env.RESEND_API_KEY, tenantEmail, storeName, dashboardUrl);
    } catch (e) {
      console.error(`webhooks: failed to send suspension email for ${tenantId}:`, e);
    }
  }

  console.log(`webhooks: tenant ${tenantId} (${storeName}) suspended.`);
}

async function restoreTenant(
  env: Bindings,
  tenantId: string,
  tenantEmail: string,
  storeName: string,
  storeUrl: string,
  db: TenantDB
): Promise<void> {
  const workerName = `${env.WORKER_SCRIPT_PREFIX}-${tenantId}`;

  // 1. Restore the TENANT_STATUS secret on the worker
  const cf = new CloudflareAPI(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
  try {
    await cf.setWorkerSecret(workerName, "TENANT_STATUS", "active");
  } catch (e) {
    console.error(`webhooks: failed to restore TENANT_STATUS for ${tenantId}:`, e);
  }

  // 2. Update tenant + subscription in DB
  await db.updateStatus(tenantId, "active");
  const sub = await db.getSubscriptionByTenantId(tenantId);
  if (sub) {
    await db.updateSubscription(sub.id, {
      status:               "active",
      payment_failed_at:    null,
      payment_failed_count: 0,
    });
  }

  // 3. Notify merchant
  if (env.RESEND_API_KEY) {
    try {
      await sendPaymentRecoveredEmail(env.RESEND_API_KEY, tenantEmail, storeName, storeUrl);
    } catch (e) {
      console.error(`webhooks: failed to send recovery email for ${tenantId}:`, e);
    }
  }

  console.log(`webhooks: tenant ${tenantId} (${storeName}) restored.`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const webhookRouter = new Hono<{ Bindings: Bindings }>();

webhookRouter.post("/stripe", async (c) => {
  const sigHeader = c.req.header("stripe-signature") ?? "";
  const secret    = c.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("webhooks: STRIPE_WEBHOOK_SECRET not set");
    return c.json({ ok: false }, 503);
  }

  // Read the raw body as text before parsing
  const rawBody = await c.req.text();

  const valid = await verifyStripeSignature(rawBody, sigHeader, secret);
  if (!valid) {
    console.warn("webhooks: invalid Stripe signature");
    return c.json({ ok: false, error: "Invalid signature" }, 400);
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const db = new TenantDB(c.env.DB);

  // ── invoice.payment_failed ────────────────────────────────────────────────
  if (event.type === "invoice.payment_failed") {
    const invoice   = event.data.object;
    const customerId = invoice.customer as string;
    if (!customerId) return c.json({ ok: true });

    const sub = await db.getSubscriptionByStripeCustomer(customerId);
    if (!sub) {
      console.warn(`webhooks: no subscription found for customer ${customerId}`);
      return c.json({ ok: true });
    }

    const tenant = await db.getTenant(sub.tenant_id);
    if (!tenant) return c.json({ ok: true });

    // Record first failure timestamp
    const now              = new Date().toISOString();
    const failedAt         = sub.payment_failed_at ?? now;
    const newCount         = sub.payment_failed_count + 1;
    const msSinceFirstFail = Date.now() - new Date(failedAt).getTime();

    await db.updateSubscription(sub.id, {
      payment_failed_at:    failedAt,
      payment_failed_count: newCount,
    });

    // Send payment failed email first (regardless of whether we suspend)
    const dashboardUrl = `https://dashboard.${c.env.BASE_DOMAIN}`;
    if (c.env.RESEND_API_KEY) {
      try {
        await sendPaymentFailedEmail(c.env.RESEND_API_KEY, tenant.email, tenant.store_name, dashboardUrl);
      } catch (e) {
        console.error("webhooks: failed to send payment failed email:", e);
      }
    }

    // Check suspension conditions: 3+ failures OR 7+ days since first failure
    const shouldSuspend = newCount >= MAX_FAILURES || msSinceFirstFail >= GRACE_PERIOD_MS;
    if (shouldSuspend && tenant.status !== "suspended") {
      await suspendTenant(c.env, tenant.id, tenant.email, tenant.store_name, db);
    }
  }

  // ── invoice.paid (payment recovered) ─────────────────────────────────────
  else if (event.type === "invoice.paid") {
    const invoice    = event.data.object;
    const customerId = invoice.customer as string;
    if (!customerId) return c.json({ ok: true });

    const sub = await db.getSubscriptionByStripeCustomer(customerId);
    if (!sub || sub.payment_failed_count === 0) return c.json({ ok: true });

    const tenant = await db.getTenant(sub.tenant_id);
    if (!tenant) return c.json({ ok: true });

    // Only restore if we were actually in a failed/suspended state
    if (
      tenant.status === "suspended" ||
      tenant.status === "payment_failed" ||
      sub.status    === "payment_failed" ||
      sub.status    === "suspended"
    ) {
      const storeUrl = tenant.store_url ?? `https://${tenant.subdomain}.${c.env.BASE_DOMAIN}`;
      await restoreTenant(c.env, tenant.id, tenant.email, tenant.store_name, storeUrl, db);
    }
  }

  // ── customer.subscription.updated ────────────────────────────────────────
  else if (event.type === "customer.subscription.updated") {
    const stripeSub  = event.data.object;
    const customerId = stripeSub.customer as string;
    if (!customerId) return c.json({ ok: true });

    const sub = await db.getSubscriptionByStripeCustomer(customerId);
    if (!sub) return c.json({ ok: true });

    const periodEnd = stripeSub.current_period_end as number | undefined;
    if (periodEnd) {
      await db.updateSubscription(sub.id, {
        current_period_end: new Date(periodEnd * 1000).toISOString(),
      });
    }
  }

  // ── customer.subscription.deleted ────────────────────────────────────────
  else if (event.type === "customer.subscription.deleted") {
    const stripeSub  = event.data.object;
    const customerId = stripeSub.customer as string;
    if (!customerId) return c.json({ ok: true });

    const sub = await db.getSubscriptionByStripeCustomer(customerId);
    if (!sub) return c.json({ ok: true });

    await db.updateSubscription(sub.id, { status: "cancelled" });
    await db.updateStatus(sub.tenant_id, "cancelled");
  }

  return c.json({ ok: true });
});
