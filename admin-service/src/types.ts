// ─── Cloudflare Worker Bindings ───────────────────────────────────────────────

export type Bindings = {
  // D1 — admin RBAC database (admin_users, roles, permissions, audit_log).
  DB: D1Database;

  // D1 — provisioning database, shared with provisioning-service.
  // Cross-bound so the admin-service can manage tenants directly.
  PROVISIONING_DB: D1Database;

  // R2 — same bucket the provisioning-service uses for compiled store
  // worker bundles. Required by POST /provisions when the admin-service
  // deploys a new tenant worker.
  WORKER_BUNDLES: R2Bucket;

  // ── Auth ───────────────────────────────────────────────────────────────
  // HS256 JWT signing secret. Required.
  JWT_SECRET: string;
  // Token TTL in seconds (parsed; default 8h if unset/invalid).
  JWT_TTL_SECONDS?: string;

  // ── First-superadmin bootstrap (one-shot) ──────────────────────────────
  // If admin_users is empty AND a login attempt's email matches BOOTSTRAP_EMAIL,
  // BOOTSTRAP_PASSWORD_HASH is verified and a superadmin row is created.
  // After the first superadmin exists this branch is unreachable.
  BOOTSTRAP_EMAIL?: string;
  BOOTSTRAP_PASSWORD_HASH?: string;

  // ── Cloudflare API credentials ─────────────────────────────────────────
  // Same scopes as provisioning-service.
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;

  // ── Public vars ────────────────────────────────────────────────────────
  BASE_DOMAIN: string;            // "upcart.online"
  WORKER_SCRIPT_PREFIX: string;   // "upcart-store"
  WORKER_BUNDLE_KEY: string;      // R2 object key, e.g. "store-worker.js"
  CORS_ORIGINS: string;           // comma-separated allowlist or "*"
  CF_WORKERS_SUBDOMAIN: string;   // for workers.dev probes during admin-create

  // ── Stripe (subscription management) ───────────────────────────────────
  // Same platform Stripe account the provisioning-service uses. Required
  // for /subscriptions endpoints; if unset those endpoints return 503.
  STRIPE_SECRET_KEY?: string;

  // ── Optional outbound email ────────────────────────────────────────────
  RESEND_API_KEY?: string;
};

// ─── Domain models ────────────────────────────────────────────────────────────

export type AdminUserStatus = "active" | "suspended" | "disabled";

export type AdminUser = {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  status: AdminUserStatus;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Role = {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type Permission = {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  category: string;
  is_system: boolean;
  created_at: string;
};

/** Hydrated user with all roles + flat permission keys. Returned by /auth/me. */
export type AdminUserWithAccess = AdminUser & {
  roles: Role[];
  permissions: string[]; // flat key list, may include "*"
};

/** A role enriched with the keys of every permission attached to it. */
export type RoleWithPermissions = Role & {
  permissions: Permission[];
};

// ─── Subscription plans + subscriptions ──────────────────────────────────────

export type BillingInterval = "day" | "week" | "month" | "year";

export type SubscriptionPlan = {
  id: string;
  key: string;                   // matches Tenant.plan
  display_name: string;
  description: string | null;
  stripe_price_id: string;
  stripe_product_id: string | null;
  amount_cents: number;
  currency: string;
  interval: BillingInterval;
  interval_count: number;
  active: boolean;
  is_default: boolean;
  trial_days: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

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
  created_at: string;
  updated_at: string;
};

export type AuditLogEntry = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

// ─── Tenant (provisioning DB) ─────────────────────────────────────────────────
// Shape mirrors provisioning-service/src/types.ts::Tenant. We re-declare it
// here so admin-service stays independently deployable. Keep in sync with the
// provisioning DB schema; only fields the admin portal needs are surfaced.

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

export type TenantPlan = "starter" | "pro" | "business";

export type Tenant = {
  id: string;
  subdomain: string;
  store_name: string;
  plan: TenantPlan;
  email: string;
  username: string | null;
  status: TenantStatus;
  cf_worker_name: string | null;
  cf_d1_id: string | null;
  cf_r2_bucket: string | null;
  cf_dns_record_id: string | null;
  cf_custom_domain_id: string | null;
  cf_route_id: string | null;
  store_url: string | null;
  admin_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Hono context augmentation ────────────────────────────────────────────────
// Set by middleware/auth.ts so every protected handler can read the caller
// without re-querying D1.

export type AuthedVariables = {
  user: AdminUserWithAccess;
  jwt: { sub: string; iat: number; exp: number };
};

// ─── Cloudflare API result types ──────────────────────────────────────────────
// Mirrors provisioning-service/src/types.ts so the copied cloudflare-api.ts
// works without modification.

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

export type CfDnsRecord = {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  created_on: string;
  modified_on: string;
};

export type CfCustomDomain = {
  id: string;
  zone_id: string;
  zone_name: string;
  hostname: string;
  service: string;
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
