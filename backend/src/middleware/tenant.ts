import { Context, Next } from "hono";
import { Bindings } from "../types";

export type TenantStore = {
  store_id: string;
  subdomain: string;
  store_name: string;
  plan_id: string;
  subscription_status: string;
  trial_ends_at: string;
  is_active: number;
};

declare module "hono" {
  interface ContextVariableMap {
    tenantId: string;
    tenantStore: TenantStore;
  }
}

/**
 * Resolves the current tenant (store) from the request's Host header.
 *
 * Resolution order:
 *  1. Exact custom domain match (verified only)
 *  2. Subdomain match ({subdomain}.yourdomain.com)
 *
 * If PLATFORM_DB is not bound (single-tenant legacy mode), the middleware
 * is a no-op and all requests pass through without tenant filtering.
 *
 * On success, sets c.var.tenantId and c.var.tenantStore.
 * Returns 404 if the store is not found, or 402 if the subscription has lapsed.
 */
export async function tenantMiddleware(
  c: Context<{ Bindings: Bindings }>,
  next: Next
): Promise<Response | void> {
  // PLATFORM_DB may not be bound in single-tenant / legacy deployments
  if (!c.env.PLATFORM_DB) {
    return next();
  }

  const host = c.req.header("host") ?? "";
  // Strip port for local dev (e.g. "localhost:8787")
  const hostname = host.split(":")[0];

  const db = c.env.PLATFORM_DB as D1Database;

  // 1. Try verified custom domain
  let store = await db
    .prepare(
      `SELECT id, subdomain, store_name, plan_id, subscription_status, trial_ends_at, is_active
       FROM stores WHERE custom_domain = ? AND custom_domain_verified = 1`
    )
    .bind(hostname)
    .first<TenantStore & { id: string }>();

  // 2. Try subdomain
  if (!store) {
    const subdomain = hostname.split(".")[0];
    store = await db
      .prepare(
        `SELECT id, subdomain, store_name, plan_id, subscription_status, trial_ends_at, is_active
         FROM stores WHERE subdomain = ?`
      )
      .bind(subdomain)
      .first<TenantStore & { id: string }>();
  }

  if (!store) {
    return c.json({ error: "Store not found." }, 404);
  }

  // Check store is active
  if (!store.is_active) {
    return c.json({ error: "This store is currently unavailable." }, 503);
  }

  // Check subscription allows traffic
  const status = store.subscription_status;
  const trialExpired =
    status === "trialing" && new Date(store.trial_ends_at).getTime() < Date.now();

  if (status === "canceled" || trialExpired) {
    return c.json(
      {
        error: "This store's subscription has ended.",
        subscription_status: status,
        trial_ends_at: store.trial_ends_at,
      },
      402
    );
  }

  c.set("tenantId", store.id);
  c.set("tenantStore", {
    store_id: store.id,
    subdomain: store.subdomain,
    store_name: store.store_name,
    plan_id: store.plan_id,
    subscription_status: store.subscription_status,
    trial_ends_at: store.trial_ends_at,
    is_active: store.is_active,
  });

  return next();
}
