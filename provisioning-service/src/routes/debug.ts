import { Hono } from "hono";
import type { Bindings } from "../types.js";
import { CloudflareAPI } from "../cloudflare-api.js";

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
    BASE_DOMAIN:           redact(c.env.BASE_DOMAIN, 99),
    WORKER_SCRIPT_PREFIX:  redact(c.env.WORKER_SCRIPT_PREFIX, 99),
    WORKER_BUNDLE_KEY:     redact(c.env.WORKER_BUNDLE_KEY, 99),
    CF_WORKERS_SUBDOMAIN:  redact(c.env.CF_WORKERS_SUBDOMAIN, 99),
    CF_ACCOUNT_ID:         redact(c.env.CF_ACCOUNT_ID),
    CF_API_TOKEN:          redact(c.env.CF_API_TOKEN),
    CF_ZONE_ID:            redact(c.env.CF_ZONE_ID),
    STRIPE_SECRET_KEY:     redact(c.env.STRIPE_SECRET_KEY),
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
debugRouter.get("/tenants", async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`
        SELECT id, subdomain, store_name, email, username, status,
               store_url, admin_url, cf_worker_name, cf_d1_id,
               cf_custom_domain_id, cf_route_id,
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
        cf_custom_domain_id: string | null; cf_route_id: string | null;
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
// Deep-diagnose a specific tenant's login path. Runs every check in order,
// including live CF API + HTTP probes, and tells you exactly what to fix.
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
      hint: "Check the email is correct. Check GET /debug/tenants for all registered accounts.",
    }, 404);
  }

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
    deploying_worker:   "BLOCKED — stuck deploying worker (bundle missing from R2, or CF API error)",
    configuring_domain: "BLOCKED — stuck binding worker to subdomain",
    finalizing:         "BLOCKED — stuck in finalizing",
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

  if (!statusOk) return c.json({ ok: false, steps });

  // ── Step 3: Required fields ────────────────────────────────────────────────
  const storeUrl   = String(row["store_url"]      ?? "").trim();
  const username   = String(row["username"]        ?? "").trim();
  const workerName = String(row["cf_worker_name"]  ?? "").trim();

  steps.push({
    step: "fields_check",
    ok: !!storeUrl && !!username && !!workerName,
    detail: {
      store_url:   storeUrl   || "(null — provisioning bug)",
      username:    username   || "(null — provisioning bug)",
      worker_name: workerName || "(null — provisioning bug)",
      routing: row["cf_custom_domain_id"]
        ? `Custom Domain (id: ${row["cf_custom_domain_id"]})`
        : row["cf_route_id"]
          ? `Worker Route fallback (id: ${row["cf_route_id"]}) — Custom Domain binding failed during provisioning`
          : "No routing binding found — neither Custom Domain nor Worker Route was recorded",
    },
  });

  if (!storeUrl || !username || !workerName) {
    return c.json({ ok: false, steps });
  }

  // ── Step 4: Verify Worker script exists in Cloudflare ─────────────────────
  // This distinguishes "routing broken" from "worker never deployed / deleted".
  const cf = new CloudflareAPI(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
  try {
    const exists = await cf.workerScriptExists(workerName);
    steps.push({
      step: "cf_worker_exists",
      ok: exists,
      detail: {
        worker_name: workerName,
        exists,
        ...(!exists && {
          hint: "The Worker script does not exist in Cloudflare — it was never deployed or was deleted. Run POST /debug/tenant/redeploy?email= to re-deploy it.",
        }),
      },
    });
    if (!exists) return c.json({ ok: false, steps });
  } catch (e) {
    steps.push({
      step: "cf_worker_exists",
      ok: false,
      detail: {
        error: (e as Error).message,
        hint: "CF API check failed — CF_ACCOUNT_ID or CF_API_TOKEN may be wrong",
      },
    });
  }

  // ── Step 5: workers.dev probe (if subdomain is known) ─────────────────────
  if (c.env.CF_WORKERS_SUBDOMAIN) {
    const workersDevUrl = `https://${workerName}.${c.env.CF_WORKERS_SUBDOMAIN}.workers.dev`;
    try {
      const t0 = Date.now();
      const res = await fetch(`${workersDevUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      const ms   = Date.now() - t0;
      const body = await res.json().catch(() => null);
      steps.push({
        step: "workers_dev_probe",
        ok: res.ok,
        detail: {
          url:    `${workersDevUrl}/health`,
          status: res.status,
          ms,
          body,
          note: res.ok
            ? "Worker is alive via workers.dev — the problem is the Custom Domain / Worker Route binding, not the worker itself. Run POST /debug/tenant/redeploy?email= to re-bind."
            : res.status === 522 || res.status === 523 || res.status === 525
              ? "522/523/525 via workers.dev means the worker script may be failing to initialize. Run POST /debug/tenant/redeploy?email= to re-deploy with the current bundle."
              : `Unexpected status ${res.status}`,
        },
      });
    } catch (e) {
      steps.push({
        step: "workers_dev_probe",
        ok: false,
        detail: {
          url:   `${workersDevUrl}/health`,
          error: (e as Error).message,
          hint:  "workers.dev subdomain may not be enabled for this worker. Run POST /debug/tenant/redeploy?email= — it enables it.",
        },
      });
    }
  } else {
    steps.push({
      step: "workers_dev_probe",
      ok: false,
      detail: { hint: "CF_WORKERS_SUBDOMAIN not set — cannot probe workers.dev URL" },
    });
  }

  // ── Step 6: /health probe via store URL ────────────────────────────────────
  try {
    const t0 = Date.now();
    const healthRes = await fetch(`${storeUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const ms   = Date.now() - t0;
    const body = await healthRes.json().catch(() => null);
    steps.push({
      step: "store_health",
      ok: healthRes.ok,
      detail: {
        url: `${storeUrl}/health`,
        status: healthRes.status,
        ms,
        body,
        ...(!healthRes.ok && healthRes.status === 522 && {
          hint: row["cf_route_id"] && !row["cf_custom_domain_id"]
            ? "522 via Worker Route — this routing method is unreliable. Run POST /debug/tenant/redeploy?email= to re-deploy and re-bind via Custom Domain."
            : "522 — the Worker exists but CF cannot route to it. Run POST /debug/tenant/redeploy?email=",
        }),
      },
    });
  } catch (e) {
    steps.push({
      step: "store_health",
      ok: false,
      detail: { url: `${storeUrl}/health`, error: (e as Error).message },
    });
  }

  // ── Step 7: /admin/login probe (intentional wrong password) ───────────────
  try {
    const t0 = Date.now();
    const loginRes = await fetch(`${storeUrl}/admin/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password: "__debug_probe__" }),
      signal:  AbortSignal.timeout(10_000),
    });
    const ms   = Date.now() - t0;
    const body = await loginRes.json().catch(() => null);
    const loginOk = loginRes.status === 401;

    steps.push({
      step: "admin_login_probe",
      ok: loginOk,
      detail: {
        url:    `${storeUrl}/admin/login`,
        status: loginRes.status,
        ms,
        body,
        note: loginOk
          ? "Got 401 as expected (bad password, but endpoint is working). The worker is live — login should work with the correct password."
          : loginRes.status >= 500
            ? `Got ${loginRes.status} — worker is misconfigured. Check ${storeUrl}/debug for details.`
            : `Unexpected status ${loginRes.status}`,
      },
    });
  } catch (e) {
    steps.push({
      step: "admin_login_probe",
      ok: false,
      detail: { url: `${storeUrl}/admin/login`, error: (e as Error).message },
    });
  }

  const allOk = steps.every(s => s.ok);
  return c.json({ ok: allOk, steps });
});

// ── POST /debug/tenant/redeploy?email=<email> ──────────────────────────────────
// Re-deploys a tenant's worker with the current R2 bundle, preserving all
// existing bindings (plain_text vars + D1 + R2) fetched from the CF API.
// Also re-enables the workers.dev subdomain and re-attempts Custom Domain binding
// so the tenant moves off the unreliable Worker Route fallback.
//
// Use this when:
//   - The tenant worker is returning 522 (routing or bundle issue)
//   - You uploaded a new bundle and want existing tenants to pick it up
//   - Custom Domain binding failed during provisioning
debugRouter.post("/tenant/redeploy", async (c) => {
  const email = (c.req.query("email") ?? "").toLowerCase().trim();
  if (!email) {
    return c.json({ ok: false, error: "Missing required query param: ?email=merchant@example.com" }, 400);
  }

  const steps: Array<{ step: string; ok: boolean; detail: unknown }> = [];

  // ── Look up tenant ─────────────────────────────────────────────────────────
  const row = await c.env.DB
    .prepare("SELECT * FROM tenants WHERE lower(email) = ?1 LIMIT 1")
    .bind(email)
    .first<Record<string, unknown>>();

  if (!row) {
    return c.json({
      ok: false,
      error: `No tenant found with email "${email}"`,
    }, 404);
  }

  const tenantId   = String(row["id"]             ?? "");
  const subdomain  = String(row["subdomain"]       ?? "");
  const workerName = String(row["cf_worker_name"]  ?? "");
  const d1IdFallback  = String(row["cf_d1_id"]    ?? "");
  const r2Fallback    = String(row["cf_r2_bucket"] ?? "");
  const oldRouteId    = String(row["cf_route_id"]  ?? "");
  const hostname   = `${subdomain}.${c.env.BASE_DOMAIN}`;

  if (!workerName) {
    return c.json({ ok: false, error: "cf_worker_name is null — worker was never deployed. Re-provision this tenant." }, 400);
  }

  const cf = new CloudflareAPI(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);

  // ── Step 1: Fetch existing Worker bindings from CF API ─────────────────────
  // This lets us re-deploy with the same vars (ADMIN_USERNAME, ADMIN_PASSWORD_HASH,
  // STORE_NAME, etc.) without needing them stored in the provisioning DB.
  let existingBindings: Array<Record<string, unknown>> = [];
  try {
    existingBindings = await cf.getWorkerBindings(workerName);
    steps.push({
      step: "get_existing_bindings",
      ok: true,
      detail: {
        count: existingBindings.length,
        types: existingBindings.map(b => `${b["type"]}:${b["name"]}`),
        note: "plain_text values preserved; secret_text values not exposed (secrets auto-preserved on redeploy)",
      },
    });
  } catch (e) {
    // Worker might not exist at all — proceed with DB fallback values
    steps.push({
      step: "get_existing_bindings",
      ok: false,
      detail: {
        error: (e as Error).message,
        note: "Could not fetch existing bindings — will reconstruct from provisioning DB values",
      },
    });
  }

  // Extract d1Id, r2Bucket, and vars from existing bindings (fall back to DB values)
  let d1Id    = d1IdFallback;
  let r2Bucket = r2Fallback;
  const vars: Record<string, string> = {};

  for (const b of existingBindings) {
    if (b["type"] === "d1"        && b["name"] === "DB")     d1Id     = String(b["id"]          ?? d1IdFallback);
    if (b["type"] === "r2_bucket" && b["name"] === "IMAGES") r2Bucket = String(b["bucket_name"] ?? r2Fallback);
    if (b["type"] === "plain_text") vars[String(b["name"])]  = String(b["text"] ?? "");
  }

  if (!d1Id || !r2Bucket) {
    return c.json({
      ok: false,
      steps,
      error: "Cannot re-deploy: D1 database ID or R2 bucket name is missing from both CF API bindings and the provisioning DB.",
    }, 400);
  }

  // ── Step 2: Fetch bundle from R2 ──────────────────────────────────────────
  let bundle: ArrayBuffer;
  try {
    const obj = await c.env.WORKER_BUNDLES.get(c.env.WORKER_BUNDLE_KEY);
    if (!obj) throw new Error(`Bundle key "${c.env.WORKER_BUNDLE_KEY}" not found in R2`);
    bundle = await obj.arrayBuffer();
    steps.push({
      step: "fetch_bundle",
      ok: true,
      detail: {
        key: c.env.WORKER_BUNDLE_KEY,
        size_bytes: obj.size,
        uploaded: obj.uploaded?.toISOString() ?? null,
      },
    });
  } catch (e) {
    steps.push({ step: "fetch_bundle", ok: false, detail: { error: (e as Error).message } });
    return c.json({ ok: false, steps });
  }

  // ── Step 3: Re-deploy Worker ───────────────────────────────────────────────
  try {
    await cf.deployWorker(workerName, bundle, d1Id, r2Bucket, vars);
    steps.push({
      step: "deploy_worker",
      ok: true,
      detail: {
        worker_name: workerName,
        d1_id: d1Id,
        r2_bucket: r2Bucket,
        vars_set: Object.keys(vars),
        note: "Secrets (JWT_SECRET, STRIPE_SECRET_KEY, etc.) are preserved automatically",
      },
    });
  } catch (e) {
    steps.push({ step: "deploy_worker", ok: false, detail: { error: (e as Error).message } });
    return c.json({ ok: false, steps });
  }

  // ── Step 4: Enable workers.dev subdomain ───────────────────────────────────
  try {
    await cf.enableWorkerSubdomain(workerName);
    const workersDevUrl = c.env.CF_WORKERS_SUBDOMAIN
      ? `https://${workerName}.${c.env.CF_WORKERS_SUBDOMAIN}.workers.dev`
      : "(CF_WORKERS_SUBDOMAIN not set)";
    steps.push({
      step: "enable_workers_dev",
      ok: true,
      detail: { url: workersDevUrl },
    });
  } catch (e) {
    steps.push({
      step: "enable_workers_dev",
      ok: false,
      detail: {
        error: (e as Error).message,
        note: "Non-fatal — Custom Domain / Route binding will still work",
      },
    });
  }

  // ── Step 5: Delete old Worker Route (if present) ──────────────────────────
  if (oldRouteId) {
    try {
      await cf.deleteWorkerRoute(c.env.CF_ZONE_ID, oldRouteId);
      await c.env.DB
        .prepare("UPDATE tenants SET cf_route_id = NULL, updated_at = ?1 WHERE id = ?2")
        .bind(new Date().toISOString(), tenantId)
        .run();
      steps.push({
        step: "delete_old_route",
        ok: true,
        detail: { route_id: oldRouteId, note: "Removed Worker Route fallback — will now bind via Custom Domain" },
      });
    } catch (e) {
      steps.push({
        step: "delete_old_route",
        ok: false,
        detail: {
          error: (e as Error).message,
          note: "Non-fatal — will attempt Custom Domain binding anyway",
        },
      });
    }
  }

  // ── Step 6: Bind via Custom Domain ────────────────────────────────────────
  // Custom Domain is the reliable path. Worker Routes + proxied DNS can result
  // in 522s because Cloudflare sometimes tries to reach an origin instead of
  // the Worker when the script has startup issues. Custom Domain binds the
  // hostname directly to the Worker at the edge.
  try {
    const customDomain = await cf.addWorkerCustomDomain(workerName, hostname, c.env.CF_ZONE_ID);
    await c.env.DB
      .prepare("UPDATE tenants SET cf_custom_domain_id = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(customDomain.id, new Date().toISOString(), tenantId)
      .run();
    steps.push({
      step: "bind_custom_domain",
      ok: true,
      detail: {
        hostname,
        custom_domain_id: customDomain.id,
        note: "Custom Domain bound — requests to " + hostname + " now route directly to the Worker",
      },
    });
  } catch (e) {
    // Custom Domain failed — fall back to Worker Route
    steps.push({
      step: "bind_custom_domain",
      ok: false,
      detail: {
        error: (e as Error).message,
        note: "Custom Domain failed — falling back to Worker Route. If this keeps failing, check CF API token has 'Workers Custom Domains: Edit' permission.",
      },
    });

    // Re-add Worker Route as fallback
    try {
      const route = await cf.addWorkerRoute(c.env.CF_ZONE_ID, `${hostname}/*`, workerName);
      await c.env.DB
        .prepare("UPDATE tenants SET cf_route_id = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(route.id, new Date().toISOString(), tenantId)
        .run();
      steps.push({
        step: "bind_worker_route_fallback",
        ok: true,
        detail: {
          route_id: route.id,
          pattern: `${hostname}/*`,
        },
      });
    } catch (e2) {
      steps.push({
        step: "bind_worker_route_fallback",
        ok: false,
        detail: { error: (e2 as Error).message },
      });
    }
  }

  const allOk = steps.every(s => s.ok);
  return c.json({
    ok: allOk,
    steps,
    next: allOk
      ? `Redeploy complete. Now verify: GET /debug/tenant?email=${email}`
      : `Some steps failed. Check individual step errors above, then retry.`,
  });
});
