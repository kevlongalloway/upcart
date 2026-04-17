import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";
import { CloudflareAPI } from "../cloudflare-api.js";

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
  // No longer required — the platform manages payments via Stripe Connect.
  // Merchants connect their bank accounts after store setup.
  stripe_publishable_key: z.string().optional().default(""),
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

// ─── Router ───────────────────────────────────────────────────────────────────

export const provisionRouter = new Hono<{ Bindings: Bindings }>();

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
  const { store, admin, stripe_publishable_key } = c.req.valid("json");
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

  // ── Create tenant record ──────────────────────────────────────────────────
  const passwordHash = await hashPassword(admin.password);

  const tenant = await tenantDB.createTenant({
    subdomain,
    store_name: store.name,
    email:      admin.email,
    username:   admin.username,
    password_hash: passwordHash,
  });

  // ── Kick off async provisioning ───────────────────────────────────────────
  // Return the tenant_id immediately; the client polls /provision/:id/status.
  c.executionCtx.waitUntil(
    runProvisioning(c.env, tenant.id, { store, admin, stripe_publishable_key }, tenantDB)
      .catch(async (e) => {
        console.error(`Provisioning failed for tenant ${tenant.id}:`, e);
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
    stripe_publishable_key: string;
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
    STRIPE_PUBLISHABLE_KEY: input.stripe_publishable_key,
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

  await cf.deployWorker(workerName, bundle, d1.uuid, r2BucketName, vars);
  created.workerName = workerName;
  await tenantDB.updateResources(tenantId, { cf_worker_name: workerName });

  // Set secrets (these are never in plain-text vars)
  await cf.setWorkerSecret(workerName, "JWT_SECRET", jwtSecret);

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
      stripe_publishable_key: input.stripe_publishable_key,
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
