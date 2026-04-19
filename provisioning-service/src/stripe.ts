// ─── Stripe REST client ───────────────────────────────────────────────────────
//
// Thin fetch-based wrapper around the Stripe REST API so we don't pull the
// full stripe-node SDK into the Worker bundle. All POSTs use
// application/x-www-form-urlencoded — that's what Stripe's public API
// expects on the wire.
//
// Test mode is entirely a function of which secret key is configured; the
// same endpoints serve test + live keys. The provisioning service is expected
// to run with test keys (sk_test_..., pk_test_...) for the free-trial signup
// flow until real billing goes live.

const STRIPE_BASE = "https://api.stripe.com/v1";

export type StripeProduct = {
  id: string;
  name: string;
  active: boolean;
};

export type StripePrice = {
  id: string;
  product: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: "day" | "week" | "month" | "year" } | null;
  active: boolean;
};

export type StripeCustomer = {
  id: string;
  email: string | null;
  name: string | null;
};

export type StripeSetupIntent = {
  id: string;
  client_secret: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "canceled"
    | "succeeded";
  payment_method: string | null;
  customer: string | null;
  usage: "on_session" | "off_session" | "on/off_session";
};

export type StripeSubscription = {
  id: string;
  status:
    | "trialing"
    | "active"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  customer: string;
  trial_end: number | null;
  current_period_end: number;
  default_payment_method: string | null;
};

export class StripeAPI {
  constructor(private readonly secretKey: string) {}

  /**
   * POST to a Stripe endpoint with form-encoded body.
   *
   * Nested params follow Stripe's bracket convention — e.g. passing
   * { "metadata[tenant_id]": "abc" } serializes to metadata%5Btenant_id%5D=abc.
   */
  private async post<T>(path: string, params: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, params);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
    };
    let body: string | undefined;

    if (params && method !== "GET") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(params).toString();
    }

    const res = await fetch(`${STRIPE_BASE}${path}`, { method, headers, body });
    const json = await res.json() as T & { error?: { message?: string; code?: string } };

    if (!res.ok) {
      const msg = json.error?.message ?? `Stripe ${res.status}`;
      const code = json.error?.code ? ` [${json.error.code}]` : "";
      throw new Error(`Stripe ${method} ${path} failed${code}: ${msg}`);
    }
    return json;
  }

  // ── Products ────────────────────────────────────────────────────────────────

  /**
   * List Stripe products by exact name match. Stripe has no server-side name
   * filter, so we fetch the first page and filter locally — good enough for
   * the one-shot "does our platform product already exist" lookup.
   */
  async findProductByName(name: string): Promise<StripeProduct | null> {
    const res = await this.get<{ data: StripeProduct[] }>(
      `/products?limit=100&active=true`
    );
    return res.data.find((p) => p.name === name) ?? null;
  }

  async createProduct(name: string): Promise<StripeProduct> {
    return this.post<StripeProduct>("/products", { name });
  }

  // ── Prices ─────────────────────────────────────────────────────────────────

  async findMonthlyPriceForProduct(
    productId: string,
    amount: number,
    currency: string
  ): Promise<StripePrice | null> {
    const res = await this.get<{ data: StripePrice[] }>(
      `/prices?product=${encodeURIComponent(productId)}&active=true&limit=100`
    );
    return (
      res.data.find(
        (p) =>
          p.unit_amount === amount &&
          p.currency === currency.toLowerCase() &&
          p.recurring?.interval === "month"
      ) ?? null
    );
  }

  async createMonthlyPrice(
    productId: string,
    amount: number,
    currency: string
  ): Promise<StripePrice> {
    return this.post<StripePrice>("/prices", {
      product: productId,
      unit_amount: String(amount),
      currency: currency.toLowerCase(),
      "recurring[interval]": "month",
    });
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  async createCustomer(input: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeCustomer> {
    const params: Record<string, string> = { email: input.email };
    if (input.name) params.name = input.name;
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      params[`metadata[${k}]`] = v;
    }
    return this.post<StripeCustomer>("/customers", params);
  }

  // ── SetupIntents ───────────────────────────────────────────────────────────

  /**
   * Create a SetupIntent tied to a customer for off-session charging later.
   * The client confirms this via Stripe.js with a card element; no charge
   * happens now. Once confirmed, the PaymentMethod is attached to the
   * customer and usable for the subscription we create in step 2.
   */
  async createSetupIntent(customerId: string): Promise<StripeSetupIntent> {
    return this.post<StripeSetupIntent>("/setup_intents", {
      customer: customerId,
      usage: "off_session",
      "payment_method_types[]": "card",
    });
  }

  async retrieveSetupIntent(id: string): Promise<StripeSetupIntent> {
    return this.get<StripeSetupIntent>(`/setup_intents/${encodeURIComponent(id)}`);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Create a trialing subscription. No invoice / charge is generated during
   * the trial; after `trial_period_days` Stripe bills the stored payment
   * method automatically.
   */
  async createTrialSubscription(input: {
    customerId: string;
    priceId: string;
    paymentMethodId: string;
    trialDays: number;
    metadata?: Record<string, string>;
  }): Promise<StripeSubscription> {
    const params: Record<string, string> = {
      customer: input.customerId,
      "items[0][price]": input.priceId,
      default_payment_method: input.paymentMethodId,
      trial_period_days: String(input.trialDays),
      // If the card fails at the end of the trial, don't mark the sub as
      // incomplete immediately — Stripe retries per the dashboard settings.
      "payment_settings[save_default_payment_method]": "on_subscription",
    };
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      params[`metadata[${k}]`] = v;
    }
    return this.post<StripeSubscription>("/subscriptions", params);
  }

  /**
   * Cancel a subscription immediately (used in rollback when provisioning
   * fails after the subscription has been created).
   */
  async cancelSubscription(id: string): Promise<void> {
    await this.request("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
  }
}
