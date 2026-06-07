// /provisions — full CRUD for tenant provisions managed by provisioning-service.
//
// • List/Read: read directly from PROVISIONING_DB.
// • Update:    targeted column updates (store_name, plan, status). Full
//              CloudflareAPI updates (e.g. redeploy worker) are deliberately
//              out of scope — they belong in provisioning-service.
// • Delete:    tear down the entire CF stack (Custom Domain → Route → DNS
//              → Worker → R2 → D1) using CloudflareAPI, then delete the row.
//              Mirrors the ordering provisioning-service uses in
//              cleanupProvisioning().
// • Create:    admin-orchestrated provision: D1 → R2 → Worker bundle deploy
//              → Custom Domain. Skips the OTP/payment/Stripe-Connect steps
//              from the public signup wizard since admin staff are the
//              actor. The store-worker DB schema lives next to this file in
//              defaults/store-schema.ts (kept narrow on purpose — operators
//              who want the full schema should onboard via the wizard).
//
// CloudflareAPI is the same client used by provisioning-service; the file is
// vendored alongside this service to keep deploys independent.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "crypto";
import type { Bindings, AuthedVariables, TenantPlan, TenantStatus } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { CloudflareAPI } from "../cloudflare-api.js";
import { hashPassword } from "../password.js";
import { requirePermissions } from "../middleware/permissions.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const provisionsRouter = new Hono<Env>();

const SUBDOMAIN_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$|^[a-z]{2,40}$/;

const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "demo",
  "provision", "static", "cdn", "media", "assets", "status",
  "support", "help", "docs", "blog", "shop",
]);

const VALID_PLANS: readonly TenantPlan[] = ["starter", "pro", "business"];
const VALID_STATUSES: readonly TenantStatus[] = [
  "provisioning", "creating_database", "creating_storage",
  "deploying_worker", "configuring_domain", "finalizing",
  "active", "payment_failed", "suspended", "cancelled", "failed",
];

const createSchema = z.object({
  store: z.object({
    name:        z.string().min(1).max(100),
    subdomain:   z.string().regex(SUBDOMAIN_RE),
    description: z.string().max(500).optional(),
    currency:    z.string().length(3),
    country:     z.string().length(2),
  }),
  admin: z.object({
    email:    z.string().email().max(200),
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(8).max(200),
  }),
  plan: z.enum(VALID_PLANS as readonly [TenantPlan, ...TenantPlan[]]).optional(),
});

const updateSchema = z.object({
  store_name: z.string().min(1).max(100).optional(),
  plan:       z.enum(VALID_PLANS  as readonly [TenantPlan, ...TenantPlan[]]).optional(),
  status:     z.enum(VALID_STATUSES as readonly [TenantStatus, ...TenantStatus[]]).optional(),
}).refine(o => Object.keys(o).length > 0, "At least one field is required.");

// ─── List provisions ──────────────────────────────────────────────────────────

provisionsRouter.get("/", requirePermissions("provisions.read"), async (c) => {
  const limit  = Math.min(Math.max(1, parseInt(c.req.query("limit")  ?? "50", 10) || 50), 200);
  const offset = Math.max(0,            parseInt(c.req.query("offset") ?? "0",  10) || 0);
  const status = c.req.query("status") ?? undefined;
  const plan   = c.req.query("plan")   ?? undefined;
  const search = c.req.query("search") ?? undefined;

  const db = new AdminDB(c.env);
  const { items, total } = await db.provisions.list({ limit, offset, status, plan, search });
  return c.json(ok({ items, total, limit, offset }));
});

// ─── Get provision ────────────────────────────────────────────────────────────

provisionsRouter.get("/:tenant_id", requirePermissions("provisions.read"), async (c) => {
  const id = c.req.param("tenant_id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.json(err("Invalid tenant ID."), 400);

  const db = new AdminDB(c.env);
  const tenant = await db.provisions.getById(id);
  if (!tenant) return c.json(err("Provision not found."), 404);
  return c.json(ok(tenant));
});

// ─── Update provision ─────────────────────────────────────────────────────────

provisionsRouter.patch(
  "/:tenant_id",
  requirePermissions("provisions.update"),
  zValidator("json", updateSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const id    = c.req.param("tenant_id");
    const patch = c.req.valid("json");
    const db    = new AdminDB(c.env);

    if (!/^[0-9a-f-]{36}$/.test(id)) return c.json(err("Invalid tenant ID."), 400);

    const existing = await db.provisions.getById(id);
    if (!existing) return c.json(err("Provision not found."), 404);

    const updated = await db.provisions.update(id, patch);

    await audit(c, {
      action: "provision.update",
      resource_type: "provision",
      resource_id: id,
      metadata: { fields: Object.keys(patch), patch },
    });

    return c.json(ok(updated));
  },
);

// ─── Delete provision (full CF teardown) ──────────────────────────────────────

provisionsRouter.delete(
  "/:tenant_id",
  requirePermissions("provisions.delete"),
  async (c) => {
    const id = c.req.param("tenant_id");
    if (!/^[0-9a-f-]{36}$/.test(id)) return c.json(err("Invalid tenant ID."), 400);

    const db = new AdminDB(c.env);
    const tenant = await db.provisions.getById(id);
    if (!tenant) return c.json(err("Provision not found."), 404);

    if (!c.env.CF_ACCOUNT_ID || !c.env.CF_API_TOKEN || !c.env.CF_ZONE_ID) {
      return c.json(err("Cloudflare credentials not configured."), 500);
    }

    const cf = new CloudflareAPI(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
    const teardownReport: Record<string, "ok" | "skipped" | "failed"> = {};
    const teardownErrors: Record<string, string> = {};

    // Order mirrors provisioning-service::cleanupProvisioning so upstream
    // bindings are torn down before the resources they reference. Each
    // step's errors are captured but never abort the rollback.
    const steps: Array<[string, (() => Promise<void>) | null]> = [
      ["custom_domain", tenant.cf_custom_domain_id
        ? () => cf.removeWorkerCustomDomain(tenant.cf_custom_domain_id!) : null],
      ["worker_route", tenant.cf_route_id
        ? () => cf.deleteWorkerRoute(c.env.CF_ZONE_ID, tenant.cf_route_id!) : null],
      ["dns_record", tenant.cf_dns_record_id
        ? () => cf.deleteDnsRecord(c.env.CF_ZONE_ID, tenant.cf_dns_record_id!) : null],
      ["worker_script", tenant.cf_worker_name
        ? () => cf.deleteWorkerScript(tenant.cf_worker_name!) : null],
      ["r2_bucket", tenant.cf_r2_bucket
        ? () => cf.deleteR2Bucket(tenant.cf_r2_bucket!) : null],
      ["d1_database", tenant.cf_d1_id
        ? () => cf.deleteD1Database(tenant.cf_d1_id!) : null],
    ];

    for (const [label, fn] of steps) {
      if (!fn) {
        teardownReport[label] = "skipped";
        continue;
      }
      try {
        await fn();
        teardownReport[label] = "ok";
      } catch (e) {
        teardownReport[label]  = "failed";
        teardownErrors[label]  = (e as Error).message;
        console.error(`provisions.delete: ${label} failed for ${id}:`, e);
      }
    }

    // Finally remove the row. If any CF step failed the row is still
    // deleted — leaving it would block re-creation under the same
    // subdomain. The audit log retains a copy of every error for forensic
    // review.
    await db.provisions.delete(id);

    await audit(c, {
      action: "provision.delete",
      resource_type: "provision",
      resource_id: id,
      metadata: {
        subdomain: tenant.subdomain,
        teardown:  teardownReport,
        errors:    teardownErrors,
      },
    });

    return c.json(ok({
      deleted: true,
      teardown: teardownReport,
      errors: teardownErrors,
    }));
  },
);

// ─── Create provision (admin orchestration) ───────────────────────────────────
//
// Creates the full CF stack and a new tenant row. Sequence:
//   1. Validate subdomain availability + uniqueness in PROVISIONING_DB.
//   2. Insert tenant row (status = "provisioning").
//   3. Create D1 database, apply minimal store-worker schema.
//   4. Create R2 bucket.
//   5. Pull worker bundle from R2 (WORKER_BUNDLES) and deploy with bindings.
//   6. Bind the Custom Domain (DNS + cert handled by Cloudflare).
//   7. Persist resource IDs + URLs on the tenant row, mark "active".
//
// On failure each created resource is best-effort cleaned up and the row is
// removed so the subdomain becomes free again.

provisionsRouter.post(
  "/",
  requirePermissions("provisions.create"),
  zValidator("json", createSchema, (r, c) => {
    if (!r.success) return c.json(err("Validation failed", r.error.flatten()), 422);
  }),
  async (c) => {
    const input = c.req.valid("json");
    const env   = c.env;

    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.CF_ZONE_ID) {
      return c.json(err("Cloudflare credentials not configured."), 500);
    }

    const subdomain = input.store.subdomain.toLowerCase();
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return c.json(err("This subdomain is reserved."), 400);
    }

    const db = new AdminDB(c.env);
    if (!(await db.provisions.isSubdomainAvailable(subdomain))) {
      return c.json(err("This subdomain is already taken."), 409);
    }

    const cf       = new CloudflareAPI(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
    const tenantId = randomUUID();
    const hostname = `${subdomain}.${env.BASE_DOMAIN}`;
    const workerName = `${env.WORKER_SCRIPT_PREFIX}-${tenantId}`;

    const created = {
      d1Id:        "",
      r2Bucket:    "",
      workerName:  "",
      dnsRecordId: "",
      routeId:     "",
    };

    try {
      // ── Insert provisioning row ───────────────────────────────────────────
      const password_hash = await hashPassword(input.admin.password);
      await db.provisions.insertAdminCreated({
        id: tenantId,
        subdomain,
        store_name: input.store.name,
        plan: input.plan ?? "starter",
        email: input.admin.email,
        username: input.admin.username,
        password_hash,
        payment_method_id: null,
      });

      // ── D1 ────────────────────────────────────────────────────────────────
      const d1 = await cf.createD1Database(`upcart-store-${tenantId}`);
      created.d1Id = d1.uuid;
      await db.provisions.update(tenantId, {
        cf_d1_id: d1.uuid, status: "creating_database",
      });

      // Apply the minimal store-worker schema — same shape provisioning-
      // service uses but trimmed to what an admin-created store needs.
      await cf.runD1Migrations(d1.uuid, MINIMAL_STORE_SCHEMA);

      // ── R2 ────────────────────────────────────────────────────────────────
      const bucketName = `upcart-store-${tenantId}`;
      await cf.createR2Bucket(bucketName);
      created.r2Bucket = bucketName;
      await db.provisions.update(tenantId, {
        cf_r2_bucket: bucketName, status: "creating_storage",
      });

      // ── Worker bundle ────────────────────────────────────────────────────
      const bundleObj = await env.WORKER_BUNDLES.get(env.WORKER_BUNDLE_KEY);
      if (!bundleObj) {
        throw new Error(
          `Worker bundle "${env.WORKER_BUNDLE_KEY}" not found in WORKER_BUNDLES bucket. ` +
            `Build the backend and upload it before creating provisions.`,
        );
      }
      const bundle = await bundleObj.arrayBuffer();

      await cf.deployWorker(workerName, bundle, d1.uuid, bucketName, {
        TENANT_ID:       tenantId,
        TENANT_STATUS:   "active",
        STORE_NAME:      input.store.name,
        DEFAULT_CURRENCY: input.store.currency.toLowerCase(),
        ADMIN_USERNAME:  input.admin.username,
        ADMIN_PASSWORD_HASH: password_hash,
      });
      created.workerName = workerName;
      await db.provisions.update(tenantId, {
        cf_worker_name: workerName, status: "deploying_worker",
      });

      // ── JWT secret for the new store ────────────────────────────────────
      const jwtSecret = generateSecret();
      await cf.setWorkerSecret(workerName, "JWT_SECRET", jwtSecret);

      // ── Bind subdomain: proxied AAAA record + Worker Route ──────────────
      // Not Custom Domains: a Custom Domain creates a separate read-only
      // "Worker" DNS record that conflicts with a Worker Route on the same
      // hostname. The proxied AAAA 100:: placeholder + Route is served over
      // HTTPS instantly by the zone's *.upcart.online universal certificate.
      const dnsRecord = await cf.createDnsRecord(env.CF_ZONE_ID, hostname);
      created.dnsRecordId = dnsRecord.id;
      await db.provisions.update(tenantId, {
        cf_dns_record_id: dnsRecord.id, status: "configuring_domain",
      });

      const route = await cf.addWorkerRoute(env.CF_ZONE_ID, `${hostname}/*`, workerName);
      created.routeId = route.id;
      await db.provisions.update(tenantId, { cf_route_id: route.id });

      // ── Finalize ─────────────────────────────────────────────────────────
      const storeUrl = `https://${hostname}`;
      const adminUrl = `${storeUrl}/admin`;
      await db.provisions.update(tenantId, {
        store_url: storeUrl,
        admin_url: adminUrl,
        status: "active",
      });

      const tenant = await db.provisions.getById(tenantId);

      await audit(c, {
        action: "provision.create",
        resource_type: "provision",
        resource_id: tenantId,
        metadata: {
          subdomain,
          plan: input.plan ?? "starter",
          worker: workerName,
          d1_id: d1.uuid,
          r2_bucket: bucketName,
          dns_record_id: dnsRecord.id,
          route_id: route.id,
        },
      });

      return c.json(ok(tenant), 201);
    } catch (e) {
      const message = (e as Error).message;
      console.error(`provisions.create: failed for ${tenantId}:`, e);

      // Best-effort rollback. Mirror cleanupProvisioning's order.
      const rollback: Array<[string, () => Promise<void>]> = [];
      if (created.routeId)     rollback.push(["worker_route", () => cf.deleteWorkerRoute(env.CF_ZONE_ID, created.routeId)]);
      if (created.dnsRecordId) rollback.push(["dns_record",   () => cf.deleteDnsRecord(env.CF_ZONE_ID, created.dnsRecordId)]);
      if (created.workerName)  rollback.push(["worker_script", () => cf.deleteWorkerScript(created.workerName)]);
      if (created.r2Bucket)    rollback.push(["r2_bucket",     () => cf.deleteR2Bucket(created.r2Bucket)]);
      if (created.d1Id)        rollback.push(["d1_database",   () => cf.deleteD1Database(created.d1Id)]);

      for (const [label, fn] of rollback) {
        try { await fn(); }
        catch (ee) { console.error(`provisions.create rollback: ${label} failed:`, ee); }
      }

      try { await db.provisions.delete(tenantId); }
      catch (ee) { console.error("provisions.create rollback: delete row failed:", ee); }

      await audit(c, {
        action: "provision.create_failed",
        resource_type: "provision",
        resource_id: tenantId,
        metadata: { subdomain, error: message },
      });

      return c.json(err(`Provisioning failed: ${message}`), 500);
    }
  },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSecret(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Minimal store-worker schema applied to admin-created provisions. The full
// schema is owned by provisioning-service — we keep this trimmed to columns
// the store worker requires to boot without a /setup wizard. Operators who
// want the full ecommerce schema should onboard via the public wizard.
const MINIMAL_STORE_SCHEMA = `
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
  amount_total INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'usd',
  metadata TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
`;
