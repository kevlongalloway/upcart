import { Hono } from "hono";
import type { Bindings } from "../types.js";

export const debugRouter = new Hono<{ Bindings: Bindings }>();

// Helper — show that a value is set without exposing it
function redact(v: string | undefined, hint = 6) {
  if (!v) return { set: false };
  return { set: true, length: v.length, hint: v.slice(0, hint) + "..." };
}

// ── GET /debug ─────────────────────────────────────────────────────────────────
// Full system check: secrets, bindings, D1 connectivity, R2 bundle presence.
// Hit this first when something is broken.
debugRouter.get("/", async (c) => {
  const out: Record<string, unknown> = {};

  // ── Vars & secrets ────────────────────────────────────────────────────────
  out.config = {
    BASE_DOMAIN:          redact(c.env.BASE_DOMAIN, 99),
    WORKER_SCRIPT_PREFIX: redact(c.env.WORKER_SCRIPT_PREFIX, 99),
    WORKER_BUNDLE_KEY:    redact(c.env.WORKER_BUNDLE_KEY, 99),
    CF_ACCOUNT_ID:        redact(c.env.CF_ACCOUNT_ID),
    CF_API_TOKEN:         redact(c.env.CF_API_TOKEN),
    CF_ZONE_ID:           redact(c.env.CF_ZONE_ID),
    STRIPE_SECRET_KEY:    redact(c.env.STRIPE_SECRET_KEY),
    STRIPE_PUBLISHABLE_KEY: redact(c.env.STRIPE_PUBLISHABLE_KEY),
    STRIPE_WEBHOOK_SECRET: redact(c.env.STRIPE_WEBHOOK_SECRET),
  };

  const missingSecrets = [
    "CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_ZONE_ID",
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY",
  ].filter(k => !c.env[k as keyof Bindings]);

  out.missing_secrets = missingSecrets;
  out.secrets_ok = missingSecrets.length === 0;

  // ── D1 connectivity ───────────────────────────────────────────────────────
  try {
    const row = await c.env.DB
      .prepare("SELECT COUNT(*) as n FROM tenants")
      .first<{ n: number }>();
    out.d1 = { ok: true, tenant_count: row?.n ?? 0 };
  } catch (e) {
    out.d1 = {
      ok: false,
      error: (e as Error).message,
      hint: "D1 binding may be missing or migrations not applied",
    };
  }

  // ── R2 bundle ─────────────────────────────────────────────────────────────
  const bundleKey = c.env.WORKER_BUNDLE_KEY || "store-worker.js";
  try {
    const obj = await c.env.WORKER_BUNDLES.get(bundleKey);
    if (obj) {
      out.bundle = {
        ok: true,
        key: bundleKey,
        size_bytes: obj.size,
        uploaded: obj.uploaded?.toISOString() ?? null,
        etag: obj.etag,
      };
    } else {
      out.bundle = {
        ok: false,
        error: `Key "${bundleKey}" not found in the upcart-worker-bundles R2 bucket`,
        fix: `cd backend && npm run build && wrangler r2 object put upcart-worker-bundles/${bundleKey} --file dist/index.js --remote`,
      };
    }
  } catch (e) {
    out.bundle = {
      ok: false,
      error: (e as Error).message,
      hint: "R2 binding may be misconfigured",
    };
  }

  const healthy =
    out.secrets_ok === true &&
    (out.d1 as Record<string, unknown>).ok === true &&
    (out.bundle as Record<string, unknown>).ok === true;

  return c.json({ ok: healthy, data: out });
});

// ── GET /debug/bundle ──────────────────────────────────────────────────────────
// Verify the compiled backend bundle is in R2 and report its metadata.
debugRouter.get("/bundle", async (c) => {
  const key = c.env.WORKER_BUNDLE_KEY || "store-worker.js";
  try {
    const obj = await c.env.WORKER_BUNDLES.get(key);
    if (!obj) {
      return c.json({
        ok: false,
        key,
        error: `Bundle not found in R2 bucket "upcart-worker-bundles"`,
        fix: `cd backend && npm run build && wrangler r2 object put upcart-worker-bundles/${key} --file dist/index.js --remote`,
      }, 404);
    }
    return c.json({
      ok: true,
      data: {
        key,
        size_bytes: obj.size,
        size_kb: Math.round(obj.size / 1024),
        uploaded: obj.uploaded?.toISOString() ?? null,
        etag: obj.etag,
        content_type: obj.httpMetadata?.contentType ?? null,
      },
    });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

// ── GET /debug/tenants ─────────────────────────────────────────────────────────
// List all tenants (latest 50) with status — quick overview without exposing
// password hashes.
debugRouter.get("/tenants", async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`
        SELECT id, subdomain, store_name, email, username, status,
               store_url, admin_url, cf_worker_name, cf_d1_id,
               error_message, created_at, updated_at
        FROM tenants
        ORDER BY created_at DESC
        LIMIT 50
      `)
      .all<{
        id: string; subdomain: string; store_name: string;
        email: string; username: string | null; status: string;
        store_url: string | null; admin_url: string | null;
        cf_worker_name: string | null; cf_d1_id: string | null;
        error_message: string | null;
        created_at: string; updated_at: string;
      }>();

    const byStatus: Record<string, number> = {};
    for (const r of rows.results) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }

    return c.json({
      ok: true,
      data: { count: rows.results.length, by_status: byStatus, tenants: rows.results },
    });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

// ── GET /debug/tenant?email=<email> ───────────────────────────────────────────
// Deep-diagnose a specific tenant's login path. Shows every check the
// POST /auth/login code path runs, plus live probes to the tenant worker.
debugRouter.get("/tenant", async (c) => {
  const email = (c.req.query("email") ?? "").toLowerCase().trim();
  if (!email) {
    return c.json({
      ok: false,
      error: "Missing required query param: ?email=merchant@example.com",
    }, 400);
  }

  const steps: Array<{ step: string; ok: boolean; detail: unknown }> = [];

  // ── Step 1: DB lookup ──────────────────────────────────────────────────────
  let row: Record<string, unknown> | null = null;
  try {
    row = await c.env.DB
      .prepare("SELECT * FROM tenants WHERE lower(email) = ?1 LIMIT 1")
      .bind(email)
      .first<Record<string, unknown>>();
  } catch (e) {
    return c.json({
      ok: false,
      step: "db_lookup",
      error: (e as Error).message,
      hint: "D1 is not responding — check binding and migrations",
    }, 500);
  }

  if (!row) {
    return c.json({
      ok: false,
      step: "db_lookup",
      error: `No tenant found with email "${email}"`,
      hint: "Check the email is correct. If signup just ran, it may still be provisioning — check GET /debug/tenants",
    }, 404);
  }

  // Safe copy — never expose password_hash
  const safe: Record<string, unknown> = { ...row };
  delete safe["password_hash"];
  delete safe["provisioning_data"];

  steps.push({ step: "db_lookup", ok: true, detail: safe });

  // ── Step 2: Status check ───────────────────────────────────────────────────
  const status = String(row["status"] ?? "");
  const statusMessages: Record<string, string> = {
    active:             "ok — proceeding to worker proxy",
    provisioning:       "BLOCKED — still in initial provisioning state",
    creating_database:  "BLOCKED — stuck creating D1 database (Cloudflare API may have timed out)",
    creating_storage:   "BLOCKED — stuck creating R2 bucket",
    deploying_worker:   "BLOCKED — stuck deploying worker (bundle missing from R2, or Cloudflare API error)",
    configuring_domain: "BLOCKED — stuck binding worker to subdomain (DNS/Custom Domain API error)",
    finalizing:         "BLOCKED — stuck in finalizing (old status; no longer used by current code)",
    failed:             `BLOCKED — provisioning failed: ${row["error_message"] ?? "no error_message stored"}`,
    suspended:          "BLOCKED — account is suspended",
    cancelled:          "BLOCKED — account is cancelled",
  };

  const statusOk = status === "active";
  steps.push({
    step: "status_check",
    ok: statusOk,
    detail: {
      status,
      message: statusMessages[status] ?? `Unknown status "${status}"`,
      error_message: row["error_message"] ?? null,
    },
  });

  if (!statusOk) {
    return c.json({ ok: false, steps }, 200);
  }

  // ── Step 3: store_url + username ───────────────────────────────────────────
  const storeUrl = String(row["store_url"] ?? "").trim();
  const username  = String(row["username"]  ?? "").trim();

  steps.push({
    step: "fields_check",
    ok: !!storeUrl && !!username,
    detail: {
      store_url: storeUrl || "(null — provisioning bug)",
      username:  username  || "(null — provisioning bug)",
      has_store_url: !!storeUrl,
      has_username:  !!username,
    },
  });

  if (!storeUrl || !username) {
    return c.json({
      ok: false,
      steps,
      hint: "store_url or username is missing even though status=active. This is a provisioning bug — the worker may have been deployed but the DB update failed.",
    });
  }

  // ── Step 4: /health probe ──────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    const healthRes = await fetch(`${storeUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const ms = Date.now() - t0;
    const healthBody = await healthRes.json().catch(() => null);
    steps.push({
      step: "worker_health",
      ok: healthRes.ok,
      detail: {
        url:    `${storeUrl}/health`,
        status: healthRes.status,
        ms,
        body:   healthBody,
        ...(!healthRes.ok && {
          hint: "Worker responded with an error. Check Cloudflare Workers logs for the tenant worker.",
        }),
      },
    });
  } catch (e) {
    steps.push({
      step: "worker_health",
      ok: false,
      detail: {
        url:   `${storeUrl}/health`,
        error: (e as Error).message,
        hint:  "Worker is unreachable. Possible causes: DNS not propagated yet, Custom Domain binding failed, or the worker script was never deployed. Check Cloudflare dashboard for worker named: " + (row["cf_worker_name"] ?? "(unknown)"),
      },
    });
  }

  // ── Step 5: /debug probe on tenant worker ──────────────────────────────────
  try {
    const debugRes = await fetch(`${storeUrl}/debug`, {
      signal: AbortSignal.timeout(10_000),
    });
    const debugBody = await debugRes.json().catch(() => null);
    steps.push({
      step: "worker_debug",
      ok: debugRes.ok,
      detail: { url: `${storeUrl}/debug`, status: debugRes.status, body: debugBody },
    });
  } catch (e) {
    steps.push({
      step: "worker_debug",
      ok: false,
      detail: {
        url:   `${storeUrl}/debug`,
        error: (e as Error).message,
        hint:  "Worker /debug unreachable — backend may not have the debug route deployed yet",
      },
    });
  }

  // ── Step 6: /admin/login probe (wrong password on purpose) ────────────────
  // A 401 = endpoint works, credentials are evaluated. 5xx = misconfiguration.
  try {
    const t0 = Date.now();
    const loginRes = await fetch(`${storeUrl}/admin/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password: "__debug_probe_bad_password__" }),
      signal:  AbortSignal.timeout(10_000),
    });
    const ms = Date.now() - t0;
    const loginBody = await loginRes.json().catch(() => null);

    const loginOk = loginRes.status === 401; // 401 = endpoint works; just wrong pw
    steps.push({
      step: "admin_login_probe",
      ok: loginOk,
      detail: {
        url:    `${storeUrl}/admin/login`,
        status: loginRes.status,
        ms,
        body:   loginBody,
        note:   loginOk
          ? "Got 401 as expected (intentionally wrong password) — endpoint is working. Real login should succeed with correct password."
          : loginRes.status >= 500
            ? "Got 5xx — worker is misconfigured. Check /debug on the tenant worker for details."
            : loginRes.status === 200
              ? "Got 200 with wrong password — something is seriously wrong with auth logic."
              : `Unexpected status ${loginRes.status}`,
      },
    });
  } catch (e) {
    steps.push({
      step: "admin_login_probe",
      ok: false,
      detail: {
        url:   `${storeUrl}/admin/login`,
        error: (e as Error).message,
        hint:  "Could not reach /admin/login",
      },
    });
  }

  const allOk = steps.every(s => s.ok);
  return c.json({ ok: allOk, steps });
});
