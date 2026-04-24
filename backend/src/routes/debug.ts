import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { ok } from "../types.js";

export const debug = new Hono<{ Bindings: Bindings }>();

// ── GET /debug ─────────────────────────────────────────────────────────────────
// Reports the configuration state of this tenant worker without exposing
// actual secret values. Use this to verify env vars were injected correctly
// by the provisioning service.
debug.get("/", async (c) => {
  const checks: Record<string, unknown> = {};

  // ── Secrets: show set/not-set + a short hint ──────────────────────────────
  const checkSecret = (value: string | undefined, hintLen = 4) => ({
    set:    !!value,
    length: value?.length ?? 0,
    hint:   value ? value.slice(0, hintLen) + "..." : null,
  });

  checks.secrets = {
    JWT_SECRET:            checkSecret(c.env.JWT_SECRET),
    ADMIN_USERNAME:        checkSecret(c.env.ADMIN_USERNAME, 99), // username is not sensitive
    ADMIN_PASSWORD_HASH:   checkSecret(c.env.ADMIN_PASSWORD_HASH),
    ADMIN_PASSWORD:        checkSecret(c.env.ADMIN_PASSWORD),     // legacy plaintext (should be empty)
    STRIPE_SECRET_KEY:     checkSecret(c.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: checkSecret(c.env.STRIPE_WEBHOOK_SECRET),
  };

  // ── Public vars ───────────────────────────────────────────────────────────
  checks.vars = {
    DB_ADAPTER:             c.env.DB_ADAPTER             ?? "(not set)",
    TENANT_ID:              c.env.TENANT_ID              ?? "(not set)",
    STORE_NAME:             c.env.STORE_NAME             ?? "(not set)",
    DEFAULT_CURRENCY:       c.env.DEFAULT_CURRENCY       ?? "(not set)",
    CORS_ORIGINS:           c.env.CORS_ORIGINS           ?? "(not set)",
    R2_PUBLIC_URL:          c.env.R2_PUBLIC_URL          ?? "(not set)",
    STRIPE_PUBLISHABLE_KEY: c.env.STRIPE_PUBLISHABLE_KEY
      ? c.env.STRIPE_PUBLISHABLE_KEY.slice(0, 8) + "..."
      : "(not set)",
  };

  // ── Auth readiness diagnosis ───────────────────────────────────────────────
  const hasJwt      = !!c.env.JWT_SECRET;
  const hasUsername = !!c.env.ADMIN_USERNAME;
  const hasHashPw   = !!c.env.ADMIN_PASSWORD_HASH;
  const hasPlainPw  = !!c.env.ADMIN_PASSWORD;
  const hasCreds    = hasUsername && (hasHashPw || hasPlainPw);

  const problems: string[] = [];
  if (!hasJwt) {
    problems.push(
      "JWT_SECRET is not set — /admin/login will return 500 'Server misconfiguration: JWT secret not set'"
    );
  }
  if (!hasUsername) {
    problems.push(
      "ADMIN_USERNAME is not set — /admin/login will return 503 'Store not yet configured'"
    );
  }
  if (!hasHashPw && !hasPlainPw) {
    problems.push(
      "Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set — /admin/login will return 503 'Store not yet configured'"
    );
  }
  if (hasPlainPw && !hasHashPw) {
    problems.push(
      "Using plaintext ADMIN_PASSWORD fallback — this works but ADMIN_PASSWORD_HASH is preferred (provisioning should always set the hash)"
    );
  }

  checks.auth_diagnosis = {
    ready_to_login:    hasJwt && hasCreds,
    can_issue_jwt:     hasJwt,
    has_username:      hasUsername,
    has_password_hash: hasHashPw,
    has_password_plain: hasPlainPw,
    auth_method:       hasHashPw ? "pbkdf2_hash" : hasPlainPw ? "plaintext_fallback" : "none",
    problems,
  };

  // ── D1 connectivity ───────────────────────────────────────────────────────
  try {
    // Probe with a simple query that works even on a freshly migrated empty DB
    const row = await c.env.DB
      .prepare("SELECT COUNT(*) as n FROM admin_accounts")
      .first<{ n: number }>();
    checks.d1 = {
      ok: true,
      admin_accounts_rows: row?.n ?? 0,
      note: row?.n === 0
        ? "admin_accounts table is empty — this is fine; env-var auth is used by provisioned tenants"
        : `${row?.n} admin account(s) found (DB-based auth available as fallback)`,
    };
  } catch (e) {
    checks.d1 = {
      ok: false,
      error: (e as Error).message,
      hint: "D1 binding is missing or tables not created — check wrangler.toml and migrations",
    };
  }

  // ── R2 connectivity ───────────────────────────────────────────────────────
  try {
    // list() with limit=1 to verify the bucket is reachable without needing any objects
    await c.env.IMAGES.list({ limit: 1 });
    checks.r2 = { ok: true };
  } catch (e) {
    checks.r2 = {
      ok: false,
      error: (e as Error).message,
      hint: "IMAGES R2 binding is missing — images upload/serve will fail",
    };
  }

  const allOk =
    (checks.auth_diagnosis as Record<string, unknown>).ready_to_login === true &&
    (checks.d1 as Record<string, unknown>).ok === true &&
    (checks.r2 as Record<string, unknown>).ok === true;

  return c.json(ok({ summary: allOk ? "ready" : "misconfigured", checks }));
});
