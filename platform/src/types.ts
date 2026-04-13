// ─── Worker Bindings ──────────────────────────────────────────────────────────

export type Env = {
  PLATFORM_DB: D1Database;

  // Secrets (wrangler secret put)
  JWT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_BASIC_PRICE_ID: string;
  STRIPE_PRO_PRICE_ID: string;

  // Public vars (wrangler.toml [vars])
  CORS_ORIGINS: string;
  BASE_DOMAIN: string;  // e.g. "upcart.store"
  TRIAL_DAYS: string;   // default "30"
};

// ─── Context Variables ────────────────────────────────────────────────────────

export type Variables = {
  jwtPayload: JwtPayload;
};

// ─── JWT ──────────────────────────────────────────────────────────────────────

export type JwtPayload = {
  sub: string;       // platform_user_id
  store_id: string;
  email: string;
  exp: number;
};

// ─── Database Models ──────────────────────────────────────────────────────────

export type PlatformUser = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Store = {
  id: string;
  platform_user_id: string;
  subdomain: string;
  store_name: string;
  store_email: string | null;
  custom_domain: string | null;
  custom_domain_verified: number; // 0 | 1
  custom_domain_verified_at: string | null;
  plan_id: string;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  subscription_current_period_end: string | null;
  is_active: number; // 0 | 1
  created_at: string;
  updated_at: string;
};

export type Plan = {
  id: string;
  name: string;
  price_cents: number;
  stripe_price_id: string | null;
  features: string; // JSON string — parse before returning to client
  sort_order: number;
  active: number;
  created_at: string;
};

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused"
  | "incomplete";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** PBKDF2-SHA256 password hash using SubtleCrypto (available in CF Workers). */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const toB64 = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
  return `${toB64(salt)}:${toB64(new Uint8Array(bits))}`;
}

/** Timing-safe password verification. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const salt = fromB64(saltB64);
  const storedHash = fromB64(hashB64);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hash = new Uint8Array(bits);
  // Constant-time comparison
  let diff = hash.length ^ storedHash.length;
  for (let i = 0; i < storedHash.length; i++) diff |= storedHash[i] ^ (hash[i] ?? 0);
  return diff === 0;
}

/** Returns days remaining in trial (0 if expired or not trialing). */
export function trialDaysRemaining(store: Store): number {
  if (store.subscription_status !== "trialing") return 0;
  const ms = new Date(store.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Whether the store's subscription allows serving traffic. */
export function isStoreActive(store: Store): boolean {
  if (!store.is_active) return false;
  const status = store.subscription_status;
  if (status === "active") return true;
  if (status === "trialing") return trialDaysRemaining(store) > 0;
  // past_due gets a grace window — let Stripe handle final cutoff
  if (status === "past_due") return true;
  return false;
}
