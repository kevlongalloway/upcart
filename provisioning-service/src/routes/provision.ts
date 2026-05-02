import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { TenantDB } from "../db.js";
import { CloudflareAPI } from "../cloudflare-api.js";
import { hashPassword } from "../password.js";
import { generateOtpCode, sendEmailOtp, sendSmsOtp } from "../otp.js";
import { DEFAULT_STORE_SCHEMA } from "../defaults/store-schema.js";

// ─── Stripe helpers (raw fetch — no SDK needed in CF Workers) ────────────────

async function stripePost(
  path: string,
  secretKey: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const e = (json as { error?: { message?: string } }).error;
    throw new Error(e?.message ?? `Stripe error ${res.status}`);
  }
  return json;
}

async function stripeGet(
  path: string,
  secretKey: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const e = (json as { error?: { message?: string } }).error;
    throw new Error(e?.message ?? `Stripe error ${res.status}`);
  }
  return json;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUBDOMAIN_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$|^[a-z]{2,40}$/;

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

const VALID_THEMES = new Set(["base", "mono", "minimal", "boutique", "bold", "studio"]);

const verifyPaymentSchema = z.object({
  currency: z.string().length(3).toLowerCase(),
  email:    z.string().email(),
});

const sendOtpSchema = z.object({
  identifier: z.string().min(1).max(320),
  channel:    z.enum(["email", "sms"]),
});

const verifyOtpSchema = z.object({
  token_id: z.string().uuid(),
  code:     z.string().length(6).regex(/^\d{6}$/),
});

const provisionSchema = z.object({
  store: z.object({
    name:        z.string().min(1).max(100),
    subdomain:   z.string().regex(SUBDOMAIN_RE, "Invalid subdomain format"),
    description: z.string().max(500).optional().default(""),
    currency:    z.string().length(3),
    country:     z.string().length(2),
    theme:       z.string().optional().default("base").transform(t => VALID_THEMES.has(t) ? t : "base"),
  }),
  admin: z.object({
    email:    z.string().email(),
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(8),
  }),
  // PaymentIntent (requires_capture) from the $1 authorization step.
  payment_intent_id: z.string().min(1),
  // PaymentMethod to store on the tenant for future subscription charges.
  payment_method_id: z.string().min(1),
  // Token ID returned by POST /provision/verify-otp. Must reference a verified,
  // non-expired token whose identifier matches admin.email.
  verification_token_id: z.string().uuid(),
  // No longer required — the platform manages payments via Stripe Connect.
  stripe_publishable_key: z.string().optional().default(""),
});

// ─── JWT secret generator ─────────────────────────────────────────────────────

function generateSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const provisionRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /provision/config
 * Returns public configuration needed by the signup wizard, including the
 * Stripe publishable key so the card element can be initialized without
 * requiring CI/CD to inject it into the static HTML at build time.
 */
provisionRouter.get("/config", (c) => {
  return c.json(ok({
    stripe_publishable_key: c.env.STRIPE_PUBLISHABLE_KEY ?? "",
  }));
});

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
 * POST /provision/send-otp
 * Generates a 6-digit OTP and delivers it to the given identifier via email
 * (Resend) or SMS (Twilio). Rate-limited to 4 sends per identifier per
 * 10-minute window (1 original + 3 resends).
 *
 * Body: { identifier: string, channel: "email" | "sms" }
 * Returns: { token_id: string, expires_in: 600 }
 */
provisionRouter.post("/send-otp", zValidator("json", sendOtpSchema), async (c) => {
  const { identifier, channel } = c.req.valid("json");
  const normalised = identifier.toLowerCase().trim();
  const tenantDB   = new TenantDB(c.env.DB);

  // Rate limit: max 4 sends per identifier per 10 minutes (1 original + 3 resends)
  const recentSends = await tenantDB.countRecentSends(normalised, channel, 10 * 60 * 1000);
  if (recentSends >= 4) {
    return c.json(
      err("Too many verification attempts. Please wait 10 minutes before requesting another code."),
      429
    );
  }

  const code      = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    if (channel === "email") {
      if (!c.env.RESEND_API_KEY) {
        return c.json(err("Email verification is not configured."), 503);
      }
      await sendEmailOtp(c.env.RESEND_API_KEY, normalised, code);
    } else {
      if (c.env.REQUIRE_SMS_VERIFICATION !== "true") {
        return c.json(err("SMS verification is not available at this time. Please use email verification."), 503);
      }
      if (!c.env.TWILIO_ACCOUNT_SID || !c.env.TWILIO_AUTH_TOKEN || !c.env.TWILIO_FROM_NUMBER) {
        return c.json(err("SMS verification is not configured."), 503);
      }
      await sendSmsOtp(
        c.env.TWILIO_ACCOUNT_SID,
        c.env.TWILIO_AUTH_TOKEN,
        c.env.TWILIO_FROM_NUMBER,
        normalised,
        code
      );
    }
  } catch (e) {
    console.error("Failed to send OTP:", e);
    return c.json(err("Failed to send verification code. Please try again."), 502);
  }

  const tokenId = await tenantDB.createVerificationToken({
    identifier: normalised,
    channel,
    code,
    expiresAt,
  });

  return c.json(ok({ token_id: tokenId, expires_in: 600 }));
});

/**
 * POST /provision/verify-otp
 * Validates a 6-digit OTP code against a previously issued token. On success
 * marks the token as verified and returns the same token_id for the client to
 * pass to POST /provision.
 *
 * Body: { token_id: string, code: string }
 * Returns: { verified: true, token_id: string }
 */
provisionRouter.post("/verify-otp", zValidator("json", verifyOtpSchema), async (c) => {
  const { token_id, code } = c.req.valid("json");
  const tenantDB = new TenantDB(c.env.DB);

  const token = await tenantDB.getVerificationToken(token_id);

  if (!token) {
    return c.json(err("Invalid verification token."), 400);
  }
  if (token.verified_at) {
    return c.json(err("This code has already been used."), 400);
  }
  if (new Date(token.expires_at) < new Date()) {
    return c.json(err("This code has expired. Please request a new one."), 400);
  }
  if (token.attempt_count >= 5) {
    return c.json(
      err("Too many incorrect attempts. Please request a new verification code."),
      429
    );
  }
  if (token.code !== code) {
    const attempts = await tenantDB.incrementAttempts(token_id);
    const remaining = Math.max(0, 5 - attempts);
    return c.json(
      err(`Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`),
      400
    );
  }

  await tenantDB.markVerified(token_id);
  return c.json(ok({ verified: true, token_id }));
});

/**
 * POST /provision/verify-payment
 * Creates a $1 (100 minor units) manual-capture PaymentIntent so the signup
 * wizard can authorize the merchant's card without charging it.  The wizard
 * confirms the intent via Stripe.js, then passes the resulting
 * payment_intent_id + payment_method_id to POST /provision.
 *
 * Body: { currency: string (3-char ISO), email: string }
 * Returns: { client_secret: string, payment_intent_id: string }
 */
provisionRouter.post(
  "/verify-payment",
  zValidator("json", verifyPaymentSchema),
  async (c) => {
    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json(err("Payment processing is not configured."), 503);
    }

    const { currency, email } = c.req.valid("json");

    try {
      const pi = await stripePost("/payment_intents", c.env.STRIPE_SECRET_KEY, {
        amount:         "100",
        currency:       currency.toLowerCase(),
        capture_method: "manual",
        // Surface the card in the PaymentIntent so we can store the PM id.
        setup_future_usage: "off_session",
        description:    "Upcart signup verification ($1 authorization hold)",
        "metadata[type]":  "signup_verification",
        "metadata[email]": email,
      });

      return c.json(ok({
        client_secret:     pi.client_secret as string,
        payment_intent_id: pi.id as string,
      }));
    } catch (e) {
      console.error("Failed to create verify-payment intent:", e);
      return c.json(err("Could not initialize payment verification. Please try again."), 502);
    }
  }
);

/**
 * POST /provision
 * Creates a new store for a sign-up. Provisions Cloudflare resources
 * asynchronously (via ctx.waitUntil) and returns the tenant_id immediately
 * so the client can poll for status.
 *
 * Requires a PaymentIntent in `requires_capture` status (produced by the
 * wizard's $1 authorization step via POST /provision/verify-payment).
 * No provisioning happens if the card has not been successfully authorized.
 */
provisionRouter.post("/", zValidator("json", provisionSchema), async (c) => {
  const { store, admin, stripe_publishable_key, payment_intent_id, payment_method_id, verification_token_id } = c.req.valid("json");
  const subdomain = store.subdomain.toLowerCase();

  // ── Validate email verification token ────────────────────────────────────
  {
    const tenantDB = new TenantDB(c.env.DB);
    const vToken   = await tenantDB.getVerificationToken(verification_token_id);

    if (!vToken || !vToken.verified_at) {
      return c.json(err("Email verification is required before creating your store."), 400);
    }
    if (vToken.identifier !== admin.email.toLowerCase().trim()) {
      return c.json(err("Verification token does not match the provided email address."), 400);
    }
    if (new Date(vToken.expires_at) < new Date()) {
      return c.json(err("Your email verification has expired. Please verify your email again."), 400);
    }
  }

  // ── Validate payment intent ───────────────────────────────────────────────
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(err("Payment processing is not configured."), 503);
  }

  let piStatus: string;
  try {
    const pi = await stripeGet(`/payment_intents/${encodeURIComponent(payment_intent_id)}`, c.env.STRIPE_SECRET_KEY);
    piStatus  = pi.status as string;
  } catch (e) {
    console.error("Failed to retrieve PaymentIntent:", e);
    return c.json(err("Could not verify payment authorization. Please try again."), 402);
  }

  // `requires_capture` = card authorized, hold placed, not yet captured.
  if (piStatus !== "requires_capture") {
    return c.json(
      err(
        piStatus === "canceled"
          ? "Your payment authorization has expired. Please go back and re-enter your card."
          : "Your card has not been authorized yet. Please complete the payment step."
      ),
      402
    );
  }

  // ── Subdomain validation ──────────────────────────────────────────────────
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return c.json(err("That subdomain is reserved. Please choose another."), 400);
  }

  const tenantDB = new TenantDB(c.env.DB);

  const available = await tenantDB.isSubdomainAvailable(subdomain);
  if (!available) {
    return c.json(err("That subdomain is already taken. Please choose another."), 409);
  }

  // ── Create tenant record ──────────────────────────────────────────────────
  const tenant = await tenantDB.createTenant({
    subdomain,
    store_name:        store.name,
    email:             admin.email,
    username:          admin.username,
    payment_method_id,
    email_verified_at: new Date().toISOString(),
  });

  // ── Kick off async provisioning ───────────────────────────────────────────
  // Return the tenant_id immediately; the client polls /provision/:id/status.
  // runProvisioning runs its own rollback on failure (Cloudflare resources +
  // tenant row + verification token + $1 auth release); the .catch here is a
  // last-resort log only.
  c.executionCtx.waitUntil(
    runProvisioning(
      c.env,
      tenant.id,
      {
        store,
        admin,
        stripe_publishable_key: stripe_publishable_key ?? "",
        payment_intent_id,
        verification_token_id,
      },
      tenantDB
    ).catch((e) => {
      console.error(
        `[provision] Unhandled error for tenant ${tenant.id} after rollback:`,
        (e as Error)?.message ?? e
      );
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

/** Run an async step up to `attempts` times, sleeping 500ms × attempt between tries. */
async function withRetry<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.warn(`cleanup: ${label} attempt ${i}/${attempts} failed: ${(e as Error).message}`);
      if (i < attempts) {
        await new Promise(r => setTimeout(r, 500 * i));
      }
    }
  }
  throw lastErr;
}

/**
 * Best-effort rollback of every artifact created during a failed provisioning
 * run.  Runs when provisioning fails partway through so the merchant's account
 * (and ours) doesn't end up with orphaned D1 databases, R2 buckets, Worker
 * scripts, DNS records, bindings, or DB rows.
 *
 * What gets removed:
 *   1. The $1 Stripe authorization hold (canceled if still uncaptured).
 *   2. Worker Custom Domain binding.
 *   3. Worker Route (fallback binding).
 *   4. DNS record for the subdomain.
 *   5. Worker script.
 *   6. R2 bucket (always empty during rollback — no uploads have run).
 *   7. D1 database.
 *   8. Verification token row (so the merchant's email/OTP can be reused).
 *   9. Tenant row (so the subdomain + email become available again).
 *
 * Deletions run in reverse order of creation so upstream bindings are removed
 * before the resources they reference. Each step is wrapped in its own retry
 * loop and try/catch — a single failure can't block the rest, and the original
 * provisioning error is always what bubbles up.
 */
async function cleanupProvisioning(
  env: Bindings,
  cf: CloudflareAPI,
  tenantDB: TenantDB,
  tenantId: string,
  verificationTokenId: string | null,
  paymentIntentId: string | null,
  created: Provisioned
): Promise<void> {
  // ── 1. Cancel any uncaptured $1 authorization hold ───────────────────────
  // The merchant's card is released as soon as the PaymentIntent is canceled;
  // leaving it in `requires_capture` would tie up funds for ~7 days.
  if (paymentIntentId && env.STRIPE_SECRET_KEY) {
    try {
      await stripePost(
        `/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
        env.STRIPE_SECRET_KEY,
        { cancellation_reason: "abandoned" }
      );
      console.log(`cleanup: canceled PaymentIntent ${paymentIntentId}`);
    } catch (e) {
      // Already-canceled or already-captured intents will throw — non-fatal.
      console.warn(
        `cleanup: could not cancel PaymentIntent ${paymentIntentId}: ${(e as Error).message}`
      );
    }
  }

  // ── 2-7. Cloudflare resources (reverse order of creation) ───────────────
  const cfSteps: Array<[string, () => Promise<void>]> = [];

  if (created.customDomainId) {
    cfSteps.push(["custom_domain", () => cf.removeWorkerCustomDomain(created.customDomainId!)]);
  }
  if (created.routeId) {
    cfSteps.push(["worker_route", () => cf.deleteWorkerRoute(env.CF_ZONE_ID, created.routeId!)]);
  }
  if (created.dnsRecordId) {
    cfSteps.push(["dns_record", () => cf.deleteDnsRecord(env.CF_ZONE_ID, created.dnsRecordId!)]);
  }
  if (created.workerName) {
    cfSteps.push(["worker_script", () => cf.deleteWorkerScript(created.workerName!)]);
  }
  if (created.r2Bucket) {
    cfSteps.push(["r2_bucket", () => cf.deleteR2Bucket(created.r2Bucket!)]);
  }
  if (created.d1Id) {
    cfSteps.push(["d1_database", () => cf.deleteD1Database(created.d1Id!)]);
  }

  for (const [label, step] of cfSteps) {
    try {
      await withRetry(label, 3, step);
      console.log(`cleanup: deleted ${label}`);
    } catch (e) {
      console.error(`cleanup: failed to delete ${label} after retries:`, (e as Error).message);
    }
  }

  // ── 8. Verification token (so the merchant can re-verify on retry) ───────
  if (verificationTokenId) {
    try {
      await tenantDB.deleteVerificationToken(verificationTokenId);
      console.log(`cleanup: deleted verification_token ${verificationTokenId}`);
    } catch (e) {
      console.error(
        `cleanup: failed to delete verification_token ${verificationTokenId}:`,
        (e as Error).message
      );
    }
  }

  // ── 9. Tenant row (so the subdomain + email become available again) ──────
  // Done last so the row remains available for inspection if the Cloudflare
  // cleanup steps above need to be retried out-of-band.
  try {
    await tenantDB.deleteTenant(tenantId);
    console.log(`cleanup: deleted tenant row ${tenantId}`);
  } catch (e) {
    console.error(
      `cleanup: failed to delete tenant row ${tenantId}:`,
      (e as Error).message
    );
  }
}

/**
 * Probe the freshly-deployed worker via its workers.dev URL until it returns
 * a 200 from /health. Custom Domain DNS can take 30+ seconds to propagate but
 * workers.dev routing is available immediately — use it as the source of
 * truth for "the worker boots cleanly with the bindings we just gave it".
 *
 * Returns true if the worker became healthy within the budget; false otherwise.
 */
async function probeWorkerHealth(
  workerName: string,
  workersDevSubdomain: string,
  attempts = 6,
  perAttemptTimeoutMs = 8_000,
  delayMs = 4_000
): Promise<{ ok: boolean; lastStatus?: number; lastError?: string }> {
  if (!workersDevSubdomain) {
    return { ok: false, lastError: "CF_WORKERS_SUBDOMAIN not configured" };
  }
  const url = `https://${workerName}.${workersDevSubdomain}.workers.dev/health`;

  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(perAttemptTimeoutMs) });
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, lastStatus };
      }
    } catch (e) {
      lastError = (e as Error).message;
    }
    if (i < attempts) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { ok: false, lastStatus, lastError };
}

async function runProvisioning(
  env: Bindings,
  tenantId: string,
  input: {
    store: z.infer<typeof provisionSchema>["store"];
    admin: z.infer<typeof provisionSchema>["admin"];
    stripe_publishable_key: string;
    payment_intent_id: string;
    verification_token_id: string;
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

  // Seed the editor's default page sections (Header / Hero / Gallery / Footer)
  // so a fresh tenant's storefront renders something on first visit, before
  // the merchant has opened the editor. The editor's own makeDefaultSchema()
  // produces an equivalent shape, so opening the editor and clicking Save
  // is the natural way to upgrade this stub to the registry-driven full
  // schema.
  await cf.runD1Query(
    d1.uuid,
    `INSERT INTO store_settings (key, value, tenant_id, updated_at)
     VALUES ('page_sections', ?, ?, datetime('now'))
     ON CONFLICT(key) DO NOTHING`,
    [JSON.stringify(DEFAULT_STORE_SCHEMA), tenantId],
  );

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

  // Stripe publishable key: always the platform's (merchants do NOT supply
  // their own Stripe keys — they connect via Stripe Connect).
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY || "";

  // Hash the admin password here so we can ship it as a plain_text env var
  // on the tenant worker. adminLogin.ts's env-var auth path reads
  // ADMIN_PASSWORD_HASH with verifyPassword, so the tenant worker can
  // authenticate the merchant without ever needing /setup to populate an
  // admin_accounts row.
  const adminPasswordHash = await hashPassword(input.admin.password);

  const vars: Record<string, string> = {
    DB_ADAPTER:            "d1",
    CORS_ORIGINS:          corsOrigins,
    CORS_METHODS:          "GET,POST,PUT,DELETE,OPTIONS",
    CSRF_ENABLED:          "false",
    STRIPE_PUBLISHABLE_KEY: publishableKey,
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
    ADMIN_USERNAME:        input.admin.username,
    ADMIN_PASSWORD_HASH:   adminPasswordHash,
  };

  await cf.deployWorker(workerName, bundle, d1.uuid, r2BucketName, vars);
  created.workerName = workerName;
  await tenantDB.updateResources(tenantId, { cf_worker_name: workerName });

  // Enable the workers.dev subdomain on this script so finalize.ts can reach
  // it via `<workerName>.<account>.workers.dev` for the /health + /setup
  // calls — same-zone worker-to-worker fetches on Custom Domains intermittently
  // return HTTP 522 for the first few minutes after binding, but workers.dev
  // routing is available immediately.
  try {
    await cf.enableWorkerSubdomain(workerName);
  } catch (e) {
    console.warn(
      `Could not enable workers.dev subdomain for ${workerName}: ${(e as Error).message}. ` +
      `Finalization will fall back to the Custom Domain URL.`
    );
  }

  // Set secrets (these are never in plain-text vars).
  //
  // JWT_SECRET is unique per tenant so a leak in one store can't be used to
  // forge admin tokens for another.
  //
  // STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are the platform's — all
  // tenants share them because all checkout flows run through the platform's
  // Stripe account via Connect destination charges. The tenant worker needs
  // them to create checkout sessions / payment intents (checkout.ts),
  // create/retrieve Connect accounts (connect.ts), and verify incoming
  // Stripe webhooks (webhooks.ts).
  await cf.setWorkerSecret(workerName, "JWT_SECRET", jwtSecret);

  if (env.STRIPE_SECRET_KEY) {
    await cf.setWorkerSecret(workerName, "STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY);
  } else {
    console.warn(
      `STRIPE_SECRET_KEY not set on provisioning worker — tenant ${tenantId} ` +
      `will not be able to run Stripe checkout until it is propagated.`
    );
  }

  if (env.STRIPE_WEBHOOK_SECRET) {
    await cf.setWorkerSecret(workerName, "STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET);
  } else {
    console.warn(
      `STRIPE_WEBHOOK_SECRET not set on provisioning worker — tenant ${tenantId} ` +
      `will reject Stripe webhooks until it is propagated.`
    );
  }

  // ── Step 4: Bind Worker to the subdomain ─────────────────────────────────
  //
  // Strategy: Custom Domains first, Worker Route as fallback.
  //
  // Custom Domains (preferred):
  //   A single PUT call binds the Worker to the hostname. Cloudflare manages
  //   the DNS record and SSL certificate automatically. We do NOT pre-create
  //   a DNS record — doing so before the Custom Domain call caused the API to
  //   return a conflict error, which silently forced every tenant onto the
  //   less-reliable Route fallback.
  //
  // Worker Route (fallback):
  //   If Custom Domains fails (permissions, plan limit, etc.) we create a
  //   proxied AAAA DNS record manually (100:: placeholder) and add a Route
  //   that maps the pattern to the Worker script. After binding succeeds we
  //   list DNS records to capture the record ID for clean deprovisioning.
  //
  await tenantDB.updateStatus(tenantId, "configuring_domain");

  try {
    const customDomain = await cf.addWorkerCustomDomain(
      workerName,
      hostname,
      env.CF_ZONE_ID
    );
    created.customDomainId = customDomain.id;
    await tenantDB.updateResources(tenantId, { cf_custom_domain_id: customDomain.id });
    console.log(
      `Bound ${hostname} to worker "${workerName}" via Custom Domains (id: ${customDomain.id})`
    );

    // Look up the DNS record that Custom Domains created (needed for cleanup
    // and for deprovisioning). If no record is found, Cloudflare did not
    // create one automatically — create it explicitly and add a Worker Route
    // so the store is reachable immediately rather than waiting (possibly
    // indefinitely) for Custom Domain DNS to propagate.
    try {
      const records = await cf.listDnsRecords(env.CF_ZONE_ID, hostname);
      const rec     = records.find(r => r.name === hostname && r.proxied);
      if (rec) {
        created.dnsRecordId = rec.id;
        await tenantDB.updateResources(tenantId, { cf_dns_record_id: rec.id });
        console.log(`Recorded DNS record ${rec.id} created by Custom Domains for ${hostname}`);
      } else {
        // Custom Domain binding exists but Cloudflare has not yet created (or
        // exposed via API) the DNS record. Create an explicit proxied AAAA
        // record + Worker Route as a belt-and-suspenders guarantee so the
        // store resolves and serves traffic while Custom Domain DNS catches up.
        console.warn(
          `[provision] No proxied DNS record found for ${hostname} after Custom Domain binding — ` +
          `adding explicit DNS record + Worker Route as backup.`
        );

        // Create the DNS record. Treat a conflict (409) as "Custom Domain
        // already created it but it is not yet visible" — re-fetch to capture
        // the ID for cleanup tracking.
        try {
          const dnsRecord = await cf.createDnsRecord(env.CF_ZONE_ID, hostname);
          created.dnsRecordId = dnsRecord.id;
          await tenantDB.updateResources(tenantId, { cf_dns_record_id: dnsRecord.id });
          console.log(`[provision] Created backup DNS record ${dnsRecord.id} for ${hostname}`);
        } catch {
          const recheckRecords = await cf.listDnsRecords(env.CF_ZONE_ID, hostname).catch(() => [] as typeof records);
          const recheckRec = recheckRecords.find(r => r.name === hostname && r.proxied);
          if (recheckRec) {
            created.dnsRecordId = recheckRec.id;
            await tenantDB.updateResources(tenantId, { cf_dns_record_id: recheckRec.id });
            console.log(`[provision] Re-captured DNS record ${recheckRec.id} for ${hostname} after conflict`);
          }
        }

        // Add Worker Route as routing backup (Custom Domain takes precedence
        // once its own DNS record appears, but this guarantees the store is
        // live in the meantime).
        try {
          const route = await cf.addWorkerRoute(env.CF_ZONE_ID, `${hostname}/*`, workerName);
          created.routeId = route.id;
          await tenantDB.updateResources(tenantId, { cf_route_id: route.id });
          console.log(`[provision] Added Worker Route backup for ${hostname} (id: ${route.id})`);
        } catch (routeErr) {
          console.warn(
            `[provision] Worker Route backup failed for ${hostname}: ${(routeErr as Error).message}`
          );
        }
      }
    } catch (e) {
      console.warn(`[provision] DNS record check/backup failed for ${hostname}: ${(e as Error).message}`);
    }
  } catch (customDomainErr) {
    console.warn(
      `[provision] Custom Domains failed for ${hostname} — falling back to Worker Route: ` +
      (customDomainErr as Error).message
    );

    // Worker Route requires a proxied DNS record to be in place first.
    const existingRecords = await cf.listDnsRecords(env.CF_ZONE_ID, hostname);
    const existingRecord  = existingRecords.find(r => r.name === hostname && r.proxied);

    let dnsRecordId: string;
    if (existingRecord) {
      dnsRecordId = existingRecord.id;
      console.log(`Re-using existing DNS record ${dnsRecordId} for ${hostname}`);
    } else {
      const dnsRecord = await cf.createDnsRecord(env.CF_ZONE_ID, hostname);
      dnsRecordId     = dnsRecord.id;
      created.dnsRecordId = dnsRecordId;
      console.log(`Created DNS record ${dnsRecordId}: ${hostname} AAAA 100:: (proxied)`);
    }
    await tenantDB.updateResources(tenantId, { cf_dns_record_id: dnsRecordId });

    const route = await cf.addWorkerRoute(env.CF_ZONE_ID, `${hostname}/*`, workerName);
    created.routeId = route.id;
    await tenantDB.updateResources(tenantId, { cf_route_id: route.id });
    console.log(
      `Bound ${hostname} to worker "${workerName}" via Worker Route (id: ${route.id})`
    );
  }

  // ── Step 5: Verify the worker boots cleanly ─────────────────────────────
  // Probe the workers.dev URL until /health returns 200. Custom Domain DNS
  // can take a while to propagate, but workers.dev routing is live as soon
  // as deployWorker returns — so a healthy probe here proves the script
  // initializes successfully with the bindings we just gave it. If it never
  // becomes healthy, we treat that as a failed provision and roll back
  // rather than leave the merchant with a tenant they can't actually log
  // into.
  await tenantDB.updateStatus(tenantId, "finalizing");

  const probe = await probeWorkerHealth(workerName, env.CF_WORKERS_SUBDOMAIN);
  if (!probe.ok) {
    throw new Error(
      `Worker ${workerName} did not pass /health probe (` +
      `last_status=${probe.lastStatus ?? "n/a"}, last_error=${probe.lastError ?? "n/a"}` +
      `). The deployed bundle is failing to boot.`
    );
  }
  console.log(`Tenant ${tenantId}: /health probe passed (status ${probe.lastStatus}).`);

  // ── Step 6: Mark active ──────────────────────────────────────────────────
  // The tenant worker boots itself from env vars:
  //   - ADMIN_USERNAME + ADMIN_PASSWORD_HASH let /admin/login authenticate
  //     the merchant against backend/src/routes/adminLogin.ts's env-var
  //     code path without a /setup handoff.
  //   - STORE_NAME / DEFAULT_CURRENCY / STORE_COUNTRY drive the storefront.
  // Custom Domain propagation catches up within seconds; the storefront
  // hostname will resolve shortly after this point.
  const storeUrl = `https://${hostname}`;
  const adminUrl = `https://dashboard.${baseDomain}`;

  await tenantDB.updateResources(tenantId, { store_url: storeUrl, admin_url: adminUrl });
  await tenantDB.updateStatus(tenantId, "active");

  // ── Capture and immediately refund the $1 authorization hold ─────────────
  // Capture first (required before refund), then refund in full so the
  // merchant's card statement shows a $0 net charge.
  if (env.STRIPE_SECRET_KEY && input.payment_intent_id) {
    try {
      await stripePost(
        `/payment_intents/${encodeURIComponent(input.payment_intent_id)}/capture`,
        env.STRIPE_SECRET_KEY,
        {}
      );
      await stripePost("/refunds", env.STRIPE_SECRET_KEY, {
        payment_intent: input.payment_intent_id,
      });
      console.log(`Captured and refunded $1 authorization for tenant ${tenantId}.`);
    } catch (e) {
      // Non-fatal — the store is live; log and continue.
      console.warn(`Failed to capture/refund $1 auth for tenant ${tenantId}:`, (e as Error).message);
    }
  }

  // ── Step 7 (non-fatal): Create Stripe Customer + Subscription ────────────
  // Creates a 90-day trialing subscription immediately after the store is
  // live. Non-fatal: provisioning succeeds even if this step fails, and
  // the subscription can be created later via a separate admin flow.
  // Requires STRIPE_PRICE_ID to be configured; skipped if it is absent.
  if (env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID) {
    try {
      const freshTenant = await tenantDB.getTenant(tenantId);
      if (freshTenant) {
        const customerParams: Record<string, string> = {
          email:                freshTenant.email,
          description:          `Upcart merchant: ${freshTenant.store_name}`,
          "metadata[tenant_id]": tenantId,
        };
        if (freshTenant.payment_method_id) {
          customerParams["invoice_settings[default_payment_method]"] = freshTenant.payment_method_id;
        }
        const customer = await stripePost("/customers", env.STRIPE_SECRET_KEY, customerParams);
        const customerId = customer.id as string;

        const trialEndUnix = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
        const subParams: Record<string, string> = {
          customer:         customerId,
          "items[0][price]": env.STRIPE_PRICE_ID,
          trial_end:        trialEndUnix.toString(),
          "metadata[tenant_id]": tenantId,
        };
        if (freshTenant.payment_method_id) {
          subParams["default_payment_method"] = freshTenant.payment_method_id;
        }
        const stripeSub = await stripePost("/subscriptions", env.STRIPE_SECRET_KEY, subParams);

        await tenantDB.createSubscription({
          tenantId,
          plan:                  "starter",
          stripeCustomerId:      customerId,
          stripeSubscriptionId:  stripeSub.id as string,
          trialEndsAt:           new Date(trialEndUnix * 1000).toISOString(),
        });

        console.log(`Tenant ${tenantId}: Stripe subscription ${stripeSub.id} created (90-day trial).`);
      }
    } catch (e) {
      console.warn(
        `Tenant ${tenantId}: failed to create Stripe subscription (store is still live):`,
        (e as Error).message
      );
    }
  } else if (!env.STRIPE_PRICE_ID) {
    console.info(
      `Tenant ${tenantId}: STRIPE_PRICE_ID not set — skipping subscription creation.`
    );
  }

  console.log(`Tenant ${tenantId} (${hostname}) provisioned successfully.`);
  } catch (e) {
    // A step failed. Mark the row "failed" first so any in-flight status poll
    // sees a clear error message before the row is hard-deleted, then run the
    // full rollback: Cloudflare resources + verification token + tenant row +
    // $1 Stripe auth release. cleanupProvisioning swallows its own errors so
    // we always reach the throw at the bottom and surface the original cause.
    const errMsg = (e as Error)?.message ?? String(e);
    console.error(`Provisioning failed for tenant ${tenantId}; rolling back:`, e);

    try {
      await tenantDB.updateStatus(tenantId, "failed", errMsg);
    } catch (statusErr) {
      console.warn(
        `cleanup: could not record "failed" status for tenant ${tenantId}: ` +
        `${(statusErr as Error).message}`
      );
    }

    await cleanupProvisioning(
      env,
      cf,
      tenantDB,
      tenantId,
      input.verification_token_id,
      input.payment_intent_id,
      created
    );

    throw e;
  }
}
