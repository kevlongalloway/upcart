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
  CF_API_TOKEN: string;   // needs Workers:Edit, D1:Edit, R2:Edit, Zone:Edit scopes

  // Zone ID for upcart.online — needed to add custom subdomain routes
  CF_ZONE_ID: string;

  // ── Config vars (set in wrangler.toml [vars]) ──
  BASE_DOMAIN: string;              // "upcart.online"
  WORKER_SCRIPT_PREFIX: string;     // "upcart-store"   → worker name = upcart-store-<tenantId>
  WORKER_BUNDLE_KEY: string;        // R2 object key of the compiled bundle, e.g. "store-worker.js"
  CORS_ORIGINS: string;             // comma-separated allowed origins, or "*"
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
  password_hash: string;
  status: TenantStatus;
  cf_worker_name: string | null;
  cf_d1_id: string | null;
  cf_r2_bucket: string | null;
  cf_route_id: string | null;
  store_url: string | null;
  admin_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Provision request ────────────────────────────────────────────────────────

export type ProvisionRequest = {
  store: {
    name: string;
    subdomain: string;
    description?: string;
    currency: string;
    country: string;
  };
  admin: {
    email: string;
    username: string;
    password: string;
  };
  stripe_publishable_key?: string;
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
