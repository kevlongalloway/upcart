// Tiny Stripe HTTP client. Mirrors the inlined helpers used by
// provisioning-service/src/routes/provision.ts — no SDK needed in CF
// Workers, just fetch + URLSearchParams.
//
// Only the endpoints the admin-service needs are wrapped here:
//   • prices.retrieve   — denormalise amount/currency/interval at create time
//   • subscriptions.retrieve / update / cancel / resume

const STRIPE_BASE = "https://api.stripe.com/v1";

// ─── Form encoding (Stripe expects nested params as foo[bar]=baz) ─────────────

function flatten(
  obj: Record<string, unknown>,
  prefix?: string,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, path, out);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === "object" && v !== null) {
          flatten(v as Record<string, unknown>, `${path}[${i}]`, out);
        } else {
          out[`${path}[${i}]`] = String(v);
        }
      });
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

async function stripeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  secretKey: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
  };
  let init: RequestInit = { method, headers };

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init = {
      ...init,
      body: new URLSearchParams(flatten(body)).toString(),
    };
  }

  const res  = await fetch(`${STRIPE_BASE}${path}`, init);
  const json = (await res.json().catch(() => ({}))) as
    | T
    | { error?: { message?: string; code?: string } };

  if (!res.ok) {
    const msg = (json as { error?: { message?: string } }).error?.message
      ?? `Stripe ${method} ${path} → HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ─── Wrapped endpoints ────────────────────────────────────────────────────────

export type StripePrice = {
  id: string;
  product: string;
  unit_amount: number | null;
  currency: string;
  recurring: {
    interval: "day" | "week" | "month" | "year";
    interval_count: number;
  } | null;
  active: boolean;
};

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  items: {
    data: Array<{
      id: string;
      price: { id: string; product: string };
    }>;
  };
};

export class StripeAPI {
  constructor(private readonly secretKey: string) {}

  retrievePrice(priceId: string): Promise<StripePrice> {
    return stripeRequest<StripePrice>("GET", `/prices/${encodeURIComponent(priceId)}`, this.secretKey);
  }

  retrieveSubscription(subId: string): Promise<StripeSubscription> {
    return stripeRequest<StripeSubscription>(
      "GET",
      `/subscriptions/${encodeURIComponent(subId)}`,
      this.secretKey,
    );
  }

  /**
   * Swap the subscription's first item to a new price. `prorate` controls
   * whether Stripe issues a credit/charge for the unused portion of the
   * current period — we pass the user's choice through.
   */
  async changeSubscriptionPrice(
    subId: string,
    newPriceId: string,
    opts: { prorate?: boolean; cancel_at_period_end?: boolean } = {},
  ): Promise<StripeSubscription> {
    const sub = await this.retrieveSubscription(subId);
    const item = sub.items?.data?.[0];
    if (!item) throw new Error(`Stripe subscription ${subId} has no items.`);

    return stripeRequest<StripeSubscription>(
      "POST",
      `/subscriptions/${encodeURIComponent(subId)}`,
      this.secretKey,
      {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: opts.prorate === false ? "none" : "create_prorations",
        cancel_at_period_end: opts.cancel_at_period_end ?? false,
      },
    );
  }

  /**
   * Cancel a subscription. `at_period_end=true` schedules the cancellation
   * for the end of the current paid period; `false` cancels immediately.
   */
  cancelSubscription(
    subId: string,
    opts: { at_period_end?: boolean } = {},
  ): Promise<StripeSubscription> {
    if (opts.at_period_end) {
      return stripeRequest<StripeSubscription>(
        "POST",
        `/subscriptions/${encodeURIComponent(subId)}`,
        this.secretKey,
        { cancel_at_period_end: true },
      );
    }
    return stripeRequest<StripeSubscription>(
      "DELETE",
      `/subscriptions/${encodeURIComponent(subId)}`,
      this.secretKey,
    );
  }

  /** Undo a `cancel_at_period_end=true` schedule. */
  reactivateSubscription(subId: string): Promise<StripeSubscription> {
    return stripeRequest<StripeSubscription>(
      "POST",
      `/subscriptions/${encodeURIComponent(subId)}`,
      this.secretKey,
      { cancel_at_period_end: false },
    );
  }
}
