# Provisioning Service

The Cloudflare Worker that turns a landing-page signup into a fully-provisioned
Upcart store. Given a subdomain and admin credentials, it creates a dedicated
D1 database, R2 bucket, DNS record, and Worker deployment for each new
merchant, and tracks the whole pipeline in a shared tenant registry.

Part of the [Upcart platform](../README.md) — serves as the onramp for the
[`landing/`](../landing) page.

---

## Architecture

```
Landing page  ─POST /provision──►  Provisioning Worker ─────┐
                                        │                    │
                                        ▼                    ▼
                                  D1: tenant                 Cloudflare API
                                  registry                  ┌──────────────┐
                                        │                    │ D1 create   │
                                        ▼                    │ R2 create   │
                                status updates              │ DNS create  │
                                        │                    │ Worker      │
                                        │                    │  upload +   │
                                        │                    │  custom     │
                                        │                    │  domain     │
                                        └──◄─ poll status ◄──┘              
```

| File | Purpose |
|------|---------|
| `src/index.ts` | Hono app: CORS, health check, router mounting. |
| `src/routes/provision.ts` | `POST /provision` + `GET /provision/check-subdomain`. Orchestrates the whole provisioning pipeline. |
| `src/routes/status.ts` | `GET /provision/:tenant_id/status` — polled by the landing page. |
| `src/cloudflare-api.ts` | Thin client for the Cloudflare REST API (D1, R2, Workers, DNS, Custom Domains). |
| `src/db.ts` | `TenantDB` — D1 queries for the tenant registry. |
| `src/types.ts` | Shared types + `ok()` / `err()` response helpers. |
| `migrations/0001_create_tenants.sql` | Tenant registry schema. |
| `migrations/0002_add_dns_tracking.sql` | Tracks DNS record + Custom Domain IDs per tenant. |
| `migrations/0003_add_stripe_connect.sql` | Stripe Connect account ID per tenant. |

### Provisioning pipeline

Each signup walks through these tenant-registry statuses:

```
provisioning → creating_database → creating_storage → deploying_worker
             → configuring_domain → finalizing → active
```

If any step fails, the tenant is moved to `failed` and `error_message` is
populated for the status endpoint to surface.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Service banner. |
| `GET` | `/health` | Health check. |
| `GET` | `/provision/check-subdomain?name=<slug>` | Availability check. |
| `POST` | `/provision` | Create a new tenant and start provisioning. Returns `{ tenant_id, status }`. |
| `GET` | `/provision/:tenant_id/status` | Poll provisioning progress. Returns `{ status, store_url, admin_url, error_message }`. |

Response envelope: `{ ok: true, data: ... }` on success, `{ ok: false, error, details? }` on failure.

### `POST /provision` payload

```json
{
  "store": {
    "name":        "Acme Goods",
    "subdomain":   "acme",
    "description": "Optional tagline",
    "currency":    "usd",
    "country":     "US",
    "theme":       "mono"    // mono | minimal | boutique | bold | studio
  },
  "admin": {
    "email":    "owner@example.com",
    "username": "owner",
    "password": "min-8-chars"
  }
}
```

Subdomains must match `/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/` (or 2–40 all-letter),
and the following are reserved: `www, api, app, admin, mail, smtp, demo,
provision, static, cdn, media, assets, status, support, help, docs, blog, shop`.

Passwords are hashed with PBKDF2-SHA256 (100,000 iterations) before being
stored in the tenant's `admin_accounts` table.

---

## Setup

### 1. Install

```bash
cd provisioning-service
npm install
```

### 2. Create the tenant registry

```bash
npm run db:create
# Copy the returned database_id into wrangler.toml
npm run db:migrate
```

### 3. Create the R2 bucket for compiled store-worker bundles

```bash
npm run r2:create
```

### 4. Build the backend and upload it as the store-worker template

Each tenant gets a fresh copy of the backend worker deployed under their own
subdomain. The provisioning service copies the compiled bundle from R2.

```bash
cd ../backend
npm run build            # produces dist/index.js
cd ../provisioning-service
npm run bundle:upload    # wrangler r2 object put upcart-worker-bundles/store-worker.js
```

Re-run `bundle:upload` every time you ship a new backend version.

### 5. Configure secrets

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ZONE_ID
```

See [`.dev.vars.example`](./.dev.vars.example) for local-dev equivalents.

The API token needs:

| Scope | Permission | Why |
|-------|------------|-----|
| Account | Workers Scripts: Edit | Deploy per-tenant workers |
| Account | D1: Edit | Create per-tenant databases |
| Account | R2 Storage: Edit | Create per-tenant image buckets |
| Account | Workers Custom Domains: Edit | Bind subdomains to workers |
| Zone (BASE_DOMAIN) | DNS: Edit | Create AAAA records for subdomains |
| Zone (BASE_DOMAIN) | Workers Routes: Edit | Fallback route creation |

### 6. Public vars in `wrangler.toml`

| Var | Purpose |
|-----|---------|
| `BASE_DOMAIN` | Root domain; stores are deployed as `<subdomain>.<BASE_DOMAIN>`. |
| `WORKER_SCRIPT_PREFIX` | Prefix for tenant worker names: `<prefix>-<tenantId>`. |
| `WORKER_BUNDLE_KEY` | R2 key of the compiled backend bundle (default `store-worker.js`). |
| `CORS_ORIGINS` | Comma-separated origins allowed to hit the provisioning API. |

### 7. Run / deploy

```bash
npm run dev       # local at http://localhost:8787
npm run deploy    # push to Cloudflare
```

---

## Known gaps

- **No automated tests.** The provisioning pipeline has a lot of moving parts (D1 create, R2 bind, DNS, Custom Domain) — a mocked test suite would pay for itself quickly.
- **No idempotency / retry keys.** A retried `POST /provision` with the same subdomain returns `409`; a retried call with a *different* subdomain from the same user creates an orphaned half-provisioned tenant if the first attempt died mid-pipeline.
- **No cleanup job.** Failed tenants leave behind real Cloudflare resources (D1 database, R2 bucket, DNS record). There's no scheduled sweeper to reclaim them.
- **Bundle upload is manual.** `npm run bundle:upload` has to be run by hand after every backend change. A GitHub Action that runs on `backend/` changes would remove the footgun.
- **No rate limiting.** `POST /provision` is unauthenticated and creates real billable Cloudflare resources — add a Durable Object or Turnstile check in front of it before exposing publicly.
