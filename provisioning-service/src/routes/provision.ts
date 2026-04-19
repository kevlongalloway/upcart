import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB, PlatformSettings } from "../db.js";
import { CloudflareAPI } from "../cloudflare-api.js";
import { StripeAPI } from "../stripe.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUBDOMAIN_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$|^[a-z]{2,40}$/;
const PBKDF2_ITERATIONS = 100_000;

// Reserved subdomains that can't be registered
const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "demo",
  "provision", "static", "cdn", "media", "assets", "status",
  "support", "help", "docs", "blog", "shop",
]);

// Store worker migrations — applied to each newly created D1 database.
// Keep in sync with backend/migrations/*.sql
const STORE_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd',
  images TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}',
  stock INTEGER NOT NULL DEFAULT -1, active INTEGER NOT NULL DEFAULT 1,
  stripe_product_id TEXT, stripe_price_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
  stripe_session_id TEXT UNIQUE, stripe_payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  customer_email TEXT, customer_name TEXT,
  shipping_name TEXT, shipping_address_line1 TEXT, shipping_address_line2 TEXT,
  shipping_city TEXT, shipping_state TEXT, shipping_postal_code TEXT,
  shipping_country TEXT, shipping_phone TEXT,
  shipping_carrier TEXT, shipping_service TEXT,
  tracking_number TEXT, label_url TEXT,
  amount_total INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'usd',
  discount_id TEXT, discount_code TEXT, discount_amount INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL, product_name TEXT NOT NULL,
  price INTEGER NOT NULL, quantity INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd'
);
CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
  code TEXT UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
  applies_to TEXT NOT NULL DEFAULT 'all', product_ids TEXT NOT NULL DEFAULT '[]',
  minimum_order_amount INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER, usage_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT, ends_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  email TEXT, password_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, subdomain TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS merchant_balances (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE,
  available_balance INTEGER NOT NULL DEFAULT 0,
  pending_balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS balance_transactions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  type TEXT NOT NULL, amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  order_id TEXT, stripe_transfer_id TEXT, stripe_payout_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_balance_txn_tenant_created
  ON balance_transactions (tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_payout_id TEXT, failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_tenant_created
  ON withdrawal_requests (tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS auto_withdrawal_settings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  minimum_amount INTEGER NOT NULL DEFAULT 1000,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ─── Schema ───────────────────────────────────────────────────────────────────

const VALID_THEMES = new Set(["mono", "minimal", "boutique", "bold", "studio"]);

const provisionSchema = z.object({
  store: z.object({
    name:        z.string().min(1).max(100),
    subdomain:   z.string().regex(SUBDOMAIN_RE, "Invalid subdomain format"),
    description: z.string().max(500).optional().default(""),
    currency:    z.string().length(3),
    country:     z.string().length(2),
    theme:       z.string().optional().default("mono").transform(t => VALID_THEMES.has(t) ? t : "mono"),
  }),
  admin: z.object({
    email:    z.string().email(),
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(8),
  }),
  // Free-trial card check. The client creates these via POST /billing-intent
  // and confirms the SetupIntent with Stripe.js before posting to /provision.
  // No charge is made now — Stripe bills after TRIAL_DAYS days.
  billing: z.object({
    customer_id:     z.string().startsWith("cus_"),
    setup_intent_id: z.string().startsWith("seti_"),
  }),
});

// Inputs for POST /provision/billing-intent.
const billingIntentSchema = z.object({
  email: z.string().email(),
  name:  z.string().max(200).optional().default(""),
});

// ─── Password hashing ─────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const keyMat  = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMat, 256
  );
  const toHex = (buf: Uint8Array) =>
    Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

// ─── JWT secret generator ─────────────────────────────────────────────────────

function generateSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Storefront asset loader ──────────────────────────────────────────────────

/**
 * List every object under `prefix` in the WORKER_BUNDLES R2 bucket and return
 * a Map<assetPath, bytes> suitable for CloudflareAPI.uploadAssets().
 *
 * The asset path is the R2 key with `prefix` stripped and a leading "/"
 * prepended — e.g. prefix "storefront/" + key "storefront/index.html" becomes
 * "/index.html", which is what Workers Static Assets expects.
 */
async function loadStorefrontFiles(
  bucket: R2Bucket,
  prefix: string
): Promise<Map<string, ArrayBuffer>> {
  const files: Map<string, ArrayBuffer> = new Map();
  let cursor: string | undefined;

  // R2 list is paginated; follow the cursor until exhausted.
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const obj of page.objects) {
      // Skip pseudo-directory markers and the prefix itself.
      if (obj.key === prefix || obj.key.endsWith("/")) continue;

      const body = await bucket.get(obj.key);
      if (!body) continue;
      const bytes   = await body.arrayBuffer();
      const relPath = obj.key.slice(prefix.length);
      files.set("/" + relPath, bytes);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return files;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const provisionRouter = new Hono<{ Bindings: Bindings }>();

// ─── Platform billing helpers ─────────────────────────────────────────────────

const DEFAULT_TRIAL_DAYS          = 14;
const DEFAULT_PLATFORM_PRODUCT    = "Upcart Subscription";
const DEFAULT_PLATFORM_AMOUNT     = 2900;   // $29.00
const DEFAULT_PLATFORM_CURRENCY   = "usd";

function resolveTrialDays(env: Bindings): number {
  const n = parseInt(env.TRIAL_DAYS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRIAL_DAYS;
}

/**
 * Return the platform subscription Price ID, creating the Product + Price in
 * Stripe on first use and caching the IDs in platform_settings. Idempotent:
 * subsequent calls return the cached ID without any Stripe round trips.
 *
 * This is what makes the deploy zero-intervention — an operator doesn't need
 * to visit the Stripe dashboard; the first signup implicitly bootstraps the
 * platform's billing catalog.
 */
async function resolvePlatformPriceId(
  stripe: StripeAPI,
  settings: PlatformSettings,
  env: Bindings
): Promise<string> {
  const cached = await settings.get("stripe_price_id");
  if (cached) return cached;

  const productName = env.PLATFORM_PRODUCT_NAME    ?? DEFAULT_PLATFORM_PRODUCT;
  const amount      = parseInt(env.PLATFORM_PRICE_AMOUNT ?? "", 10) || DEFAULT_PLATFORM_AMOUNT;
  const currency    = (env.PLATFORM_PRICE_CURRENCY ?? DEFAULT_PLATFORM_CURRENCY).toLowerCase();

  // Prefer existing Stripe objects so repeated deploys (or forgotten cache
  // clears) don't duplicate the catalog.
  let product = await stripe.findProductByName(productName);
  if (!product) product = await stripe.createProduct(productName);
  await settings.put("stripe_product_id", product.id);

  let price = await stripe.findMonthlyPriceForProduct(product.id, amount, currency);
  if (!price) price = await stripe.createMonthlyPrice(product.id, amount, currency);
  await settings.put("stripe_price_id", price.id);

  return price.id;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /provision/billing-intent
 * Step 1 of signup: we create a Stripe Customer and a SetupIntent so the
 * landing page can collect a card via Stripe Elements without charging it.
 * The returned client_secret + publishable_key are safe to expose to the
 * browser.
 */
provisionRouter.post(
  "/billing-intent",
  zValidator("json", billingIntentSchema),
  async (c) => {
    const { email, name } = c.req.valid("json");

    if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_PUBLISHABLE_KEY) {
      return c.json(
        err("Platform billing is not configured. Contact support."),
        503
      );
    }

    const stripe = new StripeAPI(c.env.STRIPE_SECRET_KEY);

    try {
      const customer     = await stripe.createCustomer({ email, name });
      const setupIntent  = await stripe.createSetupIntent(customer.id);

      return c.json(ok({
        customer_id:      customer.id,
        setup_intent_id:  setupIntent.id,
        client_secret:    setupIntent.client_secret,
        publishable_key:  c.env.STRIPE_PUBLISHABLE_KEY,
        trial_days:       resolveTrialDays(c.env),
        plan_amount:      parseInt(c.env.PLATFORM_PRICE_AMOUNT   ?? "", 10) || DEFAULT_PLATFORM_AMOUNT,
        plan_currency:    (c.env.PLATFORM_PRICE_CURRENCY ?? DEFAULT_PLATFORM_CURRENCY).toLowerCase(),
      }));
    } catch (e) {
      console.error("billing-intent failed:", e);
      return c.json(err((e as Error).message ?? "Could not start billing."), 502);
    }
  }
);

/**
 * GET /provision/check-subdomain?name=<subdomain>
 * Returns whether a subdomain is available to register.
 */
provisionRouter.get("/check-subdomain", async (c) => {
  const name = (c.req.query("name") ?? "").toLowerCase().trim();

  if (!name || !SUBDOMAIN_RE.test(name) || RESERVED_SUBDOMAINS.has(name)) {
    return c.json(ok({ available: false, reason: "invalid" }));
  }

  const tenantDB  = new TenantDB(c.env.DB);
  const available = await tenantDB.isSubdomainAvailable(name);
  return c.json(ok({ available, reason: available ? null : "taken" }));
});

/**
 * POST /provision
 * Creates a new store for a sign-up. Provisions Cloudflare resources
 * asynchronously (via ctx.waitUntil) and returns the tenant_id immediately
 * so the client can poll for status.
 */
provisionRouter.post("/", zValidator("json", provisionSchema), async (c) => {
  const { store, admin, billing } = c.req.valid("json");
  const subdomain = store.subdomain.toLowerCase();

  // ── Validation ────────────────────────────────────────────────────────────
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return c.json(err("That subdomain is reserved. Please choose another."), 400);
  }

  const tenantDB = new TenantDB(c.env.DB);

  const available = await tenantDB.isSubdomainAvailable(subdomain);
  if (!available) {
    return c.json(err("That subdomain is already taken. Please choose another."), 409);
  }

  // ── Billing check (before any Cloudflare work) ────────────────────────────
  // Verify the SetupIntent succeeded on Stripe's side and create the trialing
  // subscription. If the card is declined, failed 3DS, or otherwise incomplete,
  // we abort here so we don't waste a tenant row / CF resources.
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(err("Platform billing is not configured."), 503);
  }

  const stripe   = new StripeAPI(c.env.STRIPE_SECRET_KEY);
  const settings = new PlatformSettings(c.env.DB);

  let subscriptionId:    string;
  let paymentMethodId:   string;
  let trialEndsAt:       string | null;
  let subscriptionStatus: string;

  try {
    const setupIntent = await stripe.retrieveSetupIntent(billing.setup_intent_id);
    if (setupIntent.status !== "succeeded") {
      return c.json(
        err(`Card not confirmed (status: ${setupIntent.status}). Please re-enter your card.`),
        402
      );
    }
    if (setupIntent.customer !== billing.customer_id) {
      return c.json(err("Billing context mismatch. Please restart signup."), 400);
    }
    if (!setupIntent.payment_method) {
      return c.json(err("No payment method attached. Please re-enter your card."), 400);
    }
    paymentMethodId = setupIntent.payment_method;

    const priceId = await resolvePlatformPriceId(stripe, settings, c.env);
    const trialDays = resolveTrialDays(c.env);

    const sub = await stripe.createTrialSubscription({
      customerId:      billing.customer_id,
      priceId,
      paymentMethodId,
      trialDays,
      metadata: { subdomain, store_name: store.name },
    });

    subscriptionId     = sub.id;
    subscriptionStatus = sub.status;
    trialEndsAt        = sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null;
  } catch (e) {
    console.error("Subscription creation failed:", e);
    return c.json(
      err((e as Error).message ?? "Could not start subscription. Please try again."),
      502
    );
  }

  // ── Create tenant record ──────────────────────────────────────────────────
  const passwordHash = await hashPassword(admin.password);

  const tenant = await tenantDB.createTenant({
    subdomain,
    store_name: store.name,
    email:      admin.email,
    username:   admin.username,
    password_hash: passwordHash,
  });

  await tenantDB.updateResources(tenant.id, {
    stripe_customer_id:       billing.customer_id,
    stripe_subscription_id:   subscriptionId,
    stripe_payment_method_id: paymentMethodId,
    trial_ends_at:            trialEndsAt ?? undefined,
    subscription_status:      subscriptionStatus,
  });

  // ── Kick off async provisioning ───────────────────────────────────────────
  // Return the tenant_id immediately; the client polls /provision/:id/status.
  c.executionCtx.waitUntil(
    runProvisioning(
      c.env,
      tenant.id,
      { store, admin, subscriptionId },
      tenantDB
    ).catch(async (e) => {
      console.error(`Provisioning failed for tenant ${tenant.id}:`, e);
      // Best-effort: cancel the trialing subscription so the merchant isn't
      // billed for a store that never worked.
      try {
        await stripe.cancelSubscription(subscriptionId);
      } catch (cancelErr) {
        console.error("Also failed to cancel subscription:", cancelErr);
      }
      await tenantDB.updateStatus(tenant.id, "failed", String(e?.message ?? e));
    })
  );

  return c.json(
    ok({ tenant_id: tenant.id, status: "provisioning" }),
    202
  );
});

// ─── Provisioning orchestrator ────────────────────────────────────────────────

type Provisioned = {
  d1Id?: string;
  r2Bucket?: string;
  workerName?: string;
  dnsRecordId?: string;
  customDomainId?: string;
  routeId?: string;
};

/**
 * Best-effort rollback of resources created so far. Runs when provisioning
 * fails partway through so the merchant's account (and ours) doesn't end up
 * with orphaned D1 databases, R2 buckets, Worker scripts, DNS records, or
 * bindings that nothing will ever reference again.
 *
 * Deletions run in reverse order of creation so upstream bindings are removed
 * before the resources they reference. Each step is wrapped in its own
 * try/catch — a single failure can't block the rest, and the original
 * provisioning error is always what bubbles up.
 */
async function cleanupProvisioning(
  env: Bindings,
  cf: CloudflareAPI,
  created: Provisioned
): Promise<void> {
  const steps: Array<[string, () => Promise<void>]> = [];

  if (created.customDomainId) {
    steps.push(["custom_domain", () => cf.removeWorkerCustomDomain(created.customDomainId!)]);
  }
  if (created.routeId) {
    steps.push(["worker_route", () => cf.deleteWorkerRoute(env.CF_ZONE_ID, created.routeId!)]);
  }
  if (created.dnsRecordId) {
    steps.push(["dns_record", () => cf.deleteDnsRecord(env.CF_ZONE_ID, created.dnsRecordId!)]);
  }
  if (created.workerName) {
    steps.push(["worker_script", () => cf.deleteWorkerScript(created.workerName!)]);
  }
  if (created.r2Bucket) {
    steps.push(["r2_bucket", () => cf.deleteR2Bucket(created.r2Bucket!)]);
  }
  if (created.d1Id) {
    steps.push(["d1_database", () => cf.deleteD1Database(created.d1Id!)]);
  }

  for (const [label, step] of steps) {
    try {
      await step();
      console.log(`cleanup: deleted ${label}`);
    } catch (e) {
      console.error(`cleanup: failed to delete ${label}:`, (e as Error).message);
    }
  }
}

async function runProvisioning(
  env: Bindings,
  tenantId: string,
  input: {
    store: z.infer<typeof provisionSchema>["store"];
    admin: z.infer<typeof provisionSchema>["admin"];
    subscriptionId: string;
  },
  tenantDB: TenantDB
): Promise<void> {
  const cf         = new CloudflareAPI(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
  const subdomain  = input.store.subdomain.toLowerCase();
  const workerName = `${env.WORKER_SCRIPT_PREFIX}-${tenantId}`;
  const baseDomain = env.BASE_DOMAIN;
  const hostname   = `${subdomain}.${baseDomain}`;

  // Track every Cloudflare resource we've created so we can roll them back if
  // a later step fails.
  const created: Provisioned = {};

  try {
  // ── Step 1: Create D1 database ────────────────────────────────────────────
  await tenantDB.updateStatus(tenantId, "creating_database");

  const d1 = await cf.createD1Database(`upcart-${tenantId}`);
  created.d1Id = d1.uuid;
  await tenantDB.updateResources(tenantId, { cf_d1_id: d1.uuid });

  // Apply all store schema migrations to the new database
  await cf.runD1Migrations(d1.uuid, STORE_MIGRATIONS);

  // ── Step 2: Create R2 bucket ──────────────────────────────────────────────
  await tenantDB.updateStatus(tenantId, "creating_storage");

  const r2BucketName = `upcart-${tenantId}-images`;
  await cf.createR2Bucket(r2BucketName);
  created.r2Bucket = r2BucketName;
  await tenantDB.updateResources(tenantId, { cf_r2_bucket: r2BucketName });

  // ── Step 3: Deploy Worker ─────────────────────────────────────────────────
  await tenantDB.updateStatus(tenantId, "deploying_worker");

  // Fetch the compiled worker bundle from the WORKER_BUNDLES R2 bucket.
  const bundleObj = await env.WORKER_BUNDLES.get(env.WORKER_BUNDLE_KEY);
  if (!bundleObj) {
    throw new Error(
      `Worker bundle not found in R2: ${env.WORKER_BUNDLE_KEY}. ` +
      `Upload the compiled backend bundle first.`
    );
  }
  const bundle = await bundleObj.arrayBuffer();

  // ── Step 3a: Upload storefront static assets ─────────────────────────────
  // Pull every object under STOREFRONT_BUNDLE_PREFIX (default "storefront/")
  // out of the WORKER_BUNDLES R2 bucket and attach them to this tenant's
  // Worker as static assets. Skipped silently if the prefix is empty — the
  // Worker still runs, it just serves JSON 404s for non-API routes.
  const storefrontPrefix = env.STOREFRONT_BUNDLE_PREFIX ?? "storefront/";
  const storefrontFiles  = await loadStorefrontFiles(env.WORKER_BUNDLES, storefrontPrefix);

  let assetsJwt: string | null = null;
  if (storefrontFiles.size > 0) {
    assetsJwt = await cf.uploadAssets(workerName, storefrontFiles);
    console.log(
      `Uploaded ${storefrontFiles.size} storefront asset(s) for ${workerName}`
    );
  } else {
    console.warn(
      `No storefront files found under R2 prefix "${storefrontPrefix}"; ` +
      `tenant ${tenantId} will serve API only.`
    );
  }

  const jwtSecret = generateSecret();

  // Public (plain-text) environment variables.
  //
  // CORS_ORIGINS includes:
  //   - the store's own hostname — for the storefront fetching /products, etc.
  //   - the central dashboard     — so dashboard.<BASE_DOMAIN> can call
  //                                 /admin/* directly from the browser after
  //                                 login resolves this worker's URL.
  const corsOrigins = [
    `https://${hostname}`,
    `https://dashboard.${baseDomain}`,
  ].join(",");

  const vars: Record<string, string> = {
    DB_ADAPTER:            "d1",
    CORS_ORIGINS:          corsOrigins,
    CORS_METHODS:          "GET,POST,PUT,DELETE,OPTIONS",
    CSRF_ENABLED:          "false",
    STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY,
    DEFAULT_CURRENCY:      input.store.currency,
    R2_PUBLIC_URL:         `https://pub-${r2BucketName}.r2.dev`,
    TENANT_ID:             tenantId,
    STORE_NAME:            input.store.name,
    STORE_COUNTRY:         input.store.country,
    SHIPPING_COUNTRIES:    "US,CA,GB,AU,NZ",
    STORE_ADDRESS_LINE1:   "",
    STORE_ADDRESS_LINE2:   "",
    STORE_CITY:            "",
    STORE_STATE:           "",
    STORE_POSTAL_CODE:     "",
    STORE_PHONE:           "",
  };

  await cf.deployWorker(workerName, bundle, d1.uuid, r2BucketName, vars, assetsJwt ?? undefined);
  created.workerName = workerName;
  await tenantDB.updateResources(tenantId, { cf_worker_name: workerName });

  // Set secrets (these are never in plain-text vars).
  // STRIPE_SECRET_KEY is propagated from the platform so customer storefront
  // purchases work on Cloudflare without any per-tenant configuration.
  await cf.setWorkerSecret(workerName, "JWT_SECRET", jwtSecret);
  await cf.setWorkerSecret(workerName, "STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY);

  // ── Step 4: Provision subdomain DNS + Worker binding ─────────────────────
  //
  // We use a two-phase approach so the subdomain is fully reachable:
  //
  //   Phase A — DNS record
  //     Create a proxied AAAA record for <subdomain>.upcart.online → 100::
  //     (100:: is an unroutable IPv6 address; Cloudflare intercepts all
  //     traffic at the proxy before it ever reaches the address.)
  //     This makes the hostname resolvable and TLS-terminated by Cloudflare
  //     before any Worker binding exists.
  //
  //   Phase B — Worker binding (Custom Domain preferred, Route as fallback)
  //     Custom Domains: one API call; CF manages DNS+SSL automatically.
  //       We still create the DNS record explicitly in Phase A so we have
  //       the record ID for clean deprovisioning.
  //     Route fallback: used when Custom Domains returns an error.
  //       Requires the DNS record (Phase A) to already exist.
  //
  await tenantDB.updateStatus(tenantId, "configuring_domain");

  // ── Phase A: DNS record ───────────────────────────────────────────────────
  // Check for an existing record first — a previous failed provisioning
  // attempt may have left one behind.
  let dnsRecordId: string;

  const existingRecords = await cf.listDnsRecords(env.CF_ZONE_ID, hostname);
  const existingRecord  = existingRecords.find(
    r => r.name === hostname && r.proxied
  );

  if (existingRecord) {
    // Re-use the existing proxied record rather than creating a duplicate.
    // We don't track it on `created` because we didn't make it — a previous
    // failed run did, and its own rollback should have cleaned it up. Leaving
    // it out here avoids deleting a record that might belong to a *successful*
    // earlier provisioning that somehow ended up with a duplicate tenant row.
    dnsRecordId = existingRecord.id;
    console.log(`Re-using existing DNS record ${dnsRecordId} for ${hostname}`);
  } else {
    const dnsRecord = await cf.createDnsRecord(env.CF_ZONE_ID, hostname);
    dnsRecordId     = dnsRecord.id;
    created.dnsRecordId = dnsRecordId;
    console.log(`Created DNS record ${dnsRecordId}: ${hostname} AAAA 100:: (proxied)`);
  }

  await tenantDB.updateResources(tenantId, { cf_dns_record_id: dnsRecordId });

  // ── Phase B: Bind Worker to the subdomain ─────────────────────────────────
  // Try the Custom Domains API first.  Fall back to a Worker Route if the
  // account/plan doesn't support Custom Domains or if the API returns an error.
  let usedCustomDomain = false;

  try {
    const customDomain = await cf.addWorkerCustomDomain(
      workerName,
      hostname,
      env.CF_ZONE_ID
    );
    created.customDomainId = customDomain.id;
    await tenantDB.updateResources(tenantId, { cf_custom_domain_id: customDomain.id });
    usedCustomDomain = true;
    console.log(
      `Bound ${hostname} to worker "${workerName}" via Custom Domains (id: ${customDomain.id})`
    );
  } catch (customDomainErr) {
    // Custom Domains failed — log and fall back to Worker Routes.
    console.warn(
      `Custom Domains failed for ${hostname}, falling back to Worker Route:`,
      (customDomainErr as Error).message
    );

    const route = await cf.addWorkerRoute(env.CF_ZONE_ID, `${hostname}/*`, workerName);
    created.routeId = route.id;
    await tenantDB.updateResources(tenantId, { cf_route_id: route.id });
    console.log(
      `Bound ${hostname} to worker "${workerName}" via Worker Route (id: ${route.id})`
    );
  }

  // Give Cloudflare a moment to propagate the DNS record and binding globally
  // before we try to reach the new worker's /setup endpoint.
  const propagationDelay = usedCustomDomain ? 5000 : 3000;
  await new Promise(r => setTimeout(r, propagationDelay));

  // ── Step 5: Run store setup via the worker's /setup endpoint ─────────────
  await tenantDB.updateStatus(tenantId, "finalizing");

  const storeUrl = `https://${hostname}`;
  // Central dashboard — one deployment at dashboard.<BASE_DOMAIN> handles every
  // merchant. The dashboard resolves the tenant at login time and calls this
  // store worker directly, so we no longer deploy a per-tenant admin SPA.
  const adminUrl = `https://dashboard.${baseDomain}`;

  const setupRes = await fetch(`${storeUrl}/setup`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      store: {
        name:        input.store.name,
        description: input.store.description ?? "",
        currency:    input.store.currency,
        country:     input.store.country,
        theme:       input.store.theme ?? "mono",
      },
      admin: {
        username: input.admin.username,
        email:    input.admin.email,
        password: input.admin.password,
      },
      stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY,
    }),
  });

  if (!setupRes.ok) {
    const body = await setupRes.text();
    throw new Error(`Store setup call failed (${setupRes.status}): ${body}`);
  }

  // ── Step 6: Seed a starter product so the storefront isn't empty ─────────
  // The setup call above returns a short-lived admin JWT. Using it, drop in a
  // single placeholder product so a freshly-provisioned merchant can hit
  // their storefront and see something immediately. The merchant can edit or
  // delete it from the dashboard — this is a best-effort seed; any error
  // here is logged but does not fail provisioning.
  try {
    const setupBody = await setupRes.clone().json().catch(() => null) as
      | { ok?: boolean; data?: { token?: string } } | null;
    const seedToken = setupBody?.ok ? setupBody.data?.token : undefined;
    if (seedToken) {
      const seedRes = await fetch(`${storeUrl}/admin/products`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${seedToken}`,
        },
        body: JSON.stringify({
          name:        "Welcome to your store",
          description:
            "This is a placeholder product so your store isn't empty when " +
            "you first share the link. Edit or delete it from your " +
            "dashboard — then add your real products.",
          price:       1999, // $19.99 in smallest currency unit
          currency:    input.store.currency,
          stock:       -1,
          active:      true,
          images:      [],
          metadata:    { seeded: true },
        }),
      });
      if (!seedRes.ok) {
        const body = await seedRes.text().catch(() => "");
        console.warn(`Starter product seed failed (${seedRes.status}): ${body}`);
      }
    }
  } catch (e) {
    console.warn(`Starter product seed threw; ignoring:`, (e as Error).message);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  await tenantDB.updateResources(tenantId, { store_url: storeUrl, admin_url: adminUrl });
  await tenantDB.updateStatus(tenantId, "active");

  console.log(`Tenant ${tenantId} (${subdomain}) provisioned successfully.`);
  } catch (e) {
    // A step failed. Best-effort cleanup of anything we already created, then
    // re-throw so the outer waitUntil handler marks the tenant as "failed".
    console.error(`Provisioning failed for tenant ${tenantId}; rolling back:`, e);
    await cleanupProvisioning(env, cf, created);
    throw e;
  }
}
