// ─── Cloudflare Worker Bindings ───────────────────────────────────────────────

export type Bindings = {
  // D1 database for tenant registry
  DB: D1Database;

  // R2 bucket containing the compiled store worker bundle.
  // Upload a new bundle here whenever you deploy a new backend version:
  //   wrangler r2 object put upcart-worker-bundles/store-worker.js --file dist/index.js
  WORKER_BUNDLES: R2Bucket;

  // ── Cloudflare API credentials (set via `wrangler secret put`) ──
  CF_ACCOUNT_ID: string;
  // API token scopes required:
  //   Workers Scripts:Edit   — deploy/delete Worker scripts
  //   D1:Edit                — create D1 databases, run queries
  //   R2 Storage:Edit        — create R2 buckets
  //   Zone DNS:Edit          — create/delete DNS records in the zone
  //   Workers Routes:Edit    — add/delete Worker routes on the zone
  CF_API_TOKEN: string;

  // Zone ID for upcart.online — used for DNS record and route management
  CF_ZONE_ID: string;

  // ── Platform Stripe credentials (propagated to every tenant worker) ──
  // The platform owns one Stripe account; individual merchants connect to it
  // via Stripe Connect (see backend/src/routes/connect.ts). Each tenant worker
  // needs the platform's secret/webhook keys to create sessions + verify
  // webhooks. The publishable key is public and flows into tenant [vars];
  // the secret + webhook secret flow in as wrangler secrets per tenant.
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;

  // ── Identity verification credentials (set via `wrangler secret put`) ──
  // Resend — used to send email OTP codes during signup verification.
  // Get your API key at https://resend.com/api-keys
  RESEND_API_KEY: string;

  // Twilio — used to send SMS OTP codes during signup verification.
  // Find these at https://console.twilio.com → Account Info
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  // The Twilio phone number (E.164 format, e.g. "+15551234567") or
  // Messaging Service SID to send from.
  TWILIO_FROM_NUMBER: string;

  // ── Config vars (set in wrangler.toml [vars]) ──
  BASE_DOMAIN: string;           // "upcart.online"
  WORKER_SCRIPT_PREFIX: string;  // "upcart-store" → worker = upcart-store-<tenantId>
  WORKER_BUNDLE_KEY: string;     // R2 object key of compiled bundle, e.g. "store-worker.js"
  CORS_ORIGINS: string;          // comma-separated allowed origins, or "*"
  // Stripe Price ID for the platform subscription plan (e.g. "price_...").
  // Create a recurring price in your Stripe dashboard and paste the ID here.
  // Required for subscription creation; set to "" to skip billing at provisioning.
  STRIPE_PRICE_ID: string;

  // The account-level workers.dev subdomain. Required — provision.ts uses
  // `<worker>.<sub>.workers.dev` to reach a newly-provisioned tenant
  // worker for the inline /setup call. Same-zone Custom Domain routing
  // returns HTTP 522 for several minutes after a new binding, but
  // workers.dev lives outside the zone and is routable immediately.
  //
  // Find it at: Cloudflare dashboard → Workers & Pages → right sidebar
  // under "Subdomain". If yours shows "acmecorp.workers.dev", set this
  // to "acmecorp".
  CF_WORKERS_SUBDOMAIN: string;
};

// ─── Tenant models ────────────────────────────────────────────────────────────

export type TenantStatus =
  | "provisioning"
  | "creating_database"
  | "creating_storage"
  | "deploying_worker"
  | "configuring_domain"
  | "finalizing"
  | "active"
  | "payment_failed"
  | "suspended"
  | "cancelled"
  | "failed";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "payment_failed"
  | "suspended"
  | "cancelled";

export type Subscription = {
  id: string;
  tenant_id: string;
  plan: TenantPlan;
  status: SubscriptionStatus;
  trial_ends_at: string;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  payment_failed_at: string | null;
  payment_failed_count: number;
  reminder_30d_sent: boolean;
  reminder_7d_sent: boolean;
  reminder_1d_sent: boolean;
  expired_notice_sent: boolean;
  created_at: string;
  updated_at: string;
};

export type TenantPlan = "starter" | "pro" | "business";

export type Tenant = {
  id: string;
  subdomain: string;
  store_name: string;
  plan: TenantPlan;
  email: string;
  username: string | null;
  password_hash: string;
  status: TenantStatus;

  // Cloudflare resource IDs — tracked for updates and cleanup
  cf_worker_name: string | null;
  cf_d1_id: string | null;
  cf_r2_bucket: string | null;

  // Domain provisioning IDs
  // One of the two will be set depending on whether Custom Domains or
  // DNS + Route was used (Custom Domains is preferred; Route is fallback).
  cf_dns_record_id: string | null;     // Cloudflare DNS record ID
  cf_custom_domain_id: string | null;  // Workers Custom Domain binding ID
  cf_route_id: string | null;          // Workers Route ID (fallback only)

  // Payment method collected during signup ($1 auth flow)
  payment_method_id: string | null;

  // Identity verification timestamps (set when OTP is confirmed pre-provisioning)
  email_verified_at: string | null;
  phone_number: string | null;
  phone_verified_at: string | null;

  // Stripe Connect
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;

  // Live URLs (set once provisioning completes)
  store_url: string | null;
  admin_url: string | null;

  // Non-null only when status === "failed"
  error_message: string | null;

  created_at: string;
  updated_at: string;
};

// ─── Verification token ───────────────────────────────────────────────────────

export type VerificationToken = {
  id: string;
  identifier: string;        // email address or E.164 phone number
  channel: "email" | "sms";
  code: string;
  expires_at: string;
  verified_at: string | null;
  attempt_count: number;
  created_at: string;
};

// ─── Provision request ────────────────────────────────────────────────────────

export type ProvisionRequest = {
  store: {
    name: string;
    subdomain: string;
    description?: string;
    currency: string;
    country: string;
    theme?: string;
  };
  admin: {
    email: string;
    username: string;
    password: string;
  };
  // No longer required — the platform manages payments via Stripe Connect.
  stripe_publishable_key?: string;

  // PaymentIntent created during the $1 authorization step on the wizard.
  // Must be in `requires_capture` status before provisioning proceeds.
  payment_intent_id: string;
  // Stripe PaymentMethod attached to the PaymentIntent; stored on the tenant
  // record for future subscription charges.
  payment_method_id: string;
  // Token ID returned by POST /provision/verify-otp. Must reference a verified,
  // non-expired token whose identifier matches admin.email.
  verification_token_id: string;
};

// ─── Cloudflare API response shapes ──────────────────────────────────────────

export type CfApiResult<T> = {
  result: T;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
};

export type CfD1Database = {
  uuid: string;
  name: string;
  version: string;
  created_at: string;
};

export type CfR2Bucket = {
  name: string;
  creation_date: string;
};

export type CfWorkerScript = {
  id: string;
  etag: string;
  handlers: string[];
  modified_on: string;
};

export type CfWorkerRoute = {
  id: string;
  pattern: string;
  script: string;
};

/**
 * DNS record returned by the Cloudflare Zone DNS API.
 * Reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record
 */
export type CfDnsRecord = {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;       // e.g. "mystore.upcart.online"
  type: string;       // "A" | "AAAA" | "CNAME" | …
  content: string;    // e.g. "100::" for a proxied placeholder
  proxied: boolean;
  ttl: number;
  created_on: string;
  modified_on: string;
};

/**
 * Custom Domain binding returned by the Workers Custom Domains API.
 * Reference: https://developers.cloudflare.com/api/operations/worker-domain-list
 */
export type CfCustomDomain = {
  id: string;         // binding UUID — store this to remove the binding later
  zone_id: string;
  zone_name: string;
  hostname: string;   // e.g. "mystore.upcart.online"
  service: string;    // Worker script name
  environment: string;
};

// ─── API response helpers ─────────────────────────────────────────────────────

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: string; details?: unknown };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function err(error: string, details?: unknown): ApiError {
  return { ok: false, error, ...(details !== undefined ? { details } : {}) };
}
