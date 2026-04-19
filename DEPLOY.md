# Upcart — end-to-end deploy playbook

Five services live in this repo. Deploy them in this order and nothing else
matters — everything downstream points at the URLs produced by earlier steps.

| # | Service | Where it runs | What it becomes |
|---|---------|---------------|-----------------|
| 1 | `backend/` | Cloudflare Workers (per tenant, deployed by the provisioning service) | `https://<subdomain>.upcart.online` |
| 2 | `provisioning-service/` | Cloudflare Workers (single deployment) | `https://provision.upcart.online` |
| 3 | `landing/` | Static host (Render / CF Pages) | `https://upcart.online` |
| 4 | `admin-dashboard/` | Node host (Render / Fly / anywhere) | `https://dashboard.upcart.online` |
| 5 | `customer-store/` | Static host (Render / CF Pages) — one deploy serves every tenant's storefront via the per-tenant subdomain route | Served from `https://<subdomain>.upcart.online` via the tenant worker; hostable anywhere you want as the asset origin |

Per-tenant resources (D1, R2, Worker, DNS record, custom domain) are created
automatically by the provisioning service during signup. You never
`wrangler deploy` the backend yourself once the platform is live — you upload
a new backend *bundle* to R2 and future signups pick it up.

---

## 0. Prerequisites (one-time, ~10 min)

Do this once per environment, before you touch any of the services.

1. **Cloudflare account** with `upcart.online` (or whatever you use for
   `BASE_DOMAIN`) on it as an active zone.
2. **Wrangler** installed globally: `npm i -g wrangler` then `wrangler login`.
3. **Node 18+** on your dev machine.
4. **Stripe account** in test mode with Connect enabled
   (Dashboard → Connect → Get started; pick *Platform or marketplace* →
   *Express*).
5. **Cloudflare API token** with the scopes listed in
   `provisioning-service/wrangler.toml` (Workers Scripts:Edit, D1:Edit,
   R2 Storage:Edit, Workers Custom Domains:Edit, DNS:Edit,
   Workers Routes:Edit). Save the token — Step 2 needs it.
6. **Grab IDs** from the Cloudflare dashboard:
   - **Account ID** — right sidebar on any dashboard page.
   - **Zone ID** — right sidebar on the `upcart.online` zone overview.
7. **Stripe keys** — from Dashboard → Developers → API keys:
   - `STRIPE_SECRET_KEY` (`sk_test_…` / `sk_live_…`)
   - `STRIPE_PUBLISHABLE_KEY` (`pk_test_…` / `pk_live_…`)
   You'll add the webhook secret in Step 2.6.

---

## 1. Backend — upload the tenant worker bundle to R2

The backend code is never deployed on its own; each tenant gets its own
Worker spun up by the provisioning service from a bundle in R2. What we do
here is **build it and stage it in R2** so signups have something to clone.

```bash
cd backend
npm install
npm run build
```

`npm run build` runs `wrangler deploy --dry-run --outdir dist` and writes
`dist/index.js` — the single-file ES-module bundle the provisioning service
will upload to new tenants.

> If you see `missing database_id` errors from the dry-run, that's fine to
> ignore for this step — we only need the bundle. Leave the placeholder in
> `wrangler.toml` alone.

**Do not** run `npm run deploy` here. That's for the legacy single-tenant
deploy mode and will create a rogue `ecommaxxing` worker you don't want.

No D1 / R2 / secrets are created at this step — all of that happens per
tenant at signup time.

---

## 2. Provisioning service — the tenant factory

This is the single shared Worker that every merchant signup hits. It owns
the tenant registry, the compiled backend bundle, and the platform's Stripe
credentials.

### 2.1 Install

```bash
cd ../provisioning-service
npm install
```

### 2.2 Create the tenant registry D1 database

```bash
npm run db:create
```

Copy the returned `database_id` into `provisioning-service/wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "upcart-provisioning-db"
database_id   = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Then apply the four registry migrations:

```bash
npm run db:migrate
```

### 2.3 Create the bundle bucket and upload the backend bundle

```bash
npm run r2:create          # creates upcart-worker-bundles
npm run bundle:upload      # uploads ../backend/dist/index.js as store-worker.js
```

Re-run `bundle:upload` every time you ship a new backend version. Existing
tenants keep running their old bundle; only *new* signups pick up the fresh
one. (Rolling tenants forward is a separate story — there's no automated
re-deploy loop today.)

### 2.4 Point your base domain + dashboard DNS

- In Cloudflare DNS, make sure `upcart.online` (the `BASE_DOMAIN` in
  `wrangler.toml`) resolves.
- Add a DNS record for `provision.upcart.online` — leave it as a placeholder
  (e.g. AAAA `100::` proxied); Wrangler will replace it when you deploy
  with a custom domain in Step 2.7.
- Add a DNS record for `dashboard.upcart.online` that points at wherever
  you're hosting the admin dashboard (Step 4).

### 2.5 Configure secrets

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ZONE_ID

# Platform Stripe — propagated to every tenant worker at provisioning time
wrangler secret put STRIPE_SECRET_KEY        # sk_live_... or sk_test_...
wrangler secret put STRIPE_PUBLISHABLE_KEY   # pk_live_... or pk_test_...
# STRIPE_WEBHOOK_SECRET: set in Step 2.6
```

### 2.6 Deploy and register the Stripe webhook

```bash
npm run deploy
```

The service is now live at `https://upcart-provisioning.<your-workers-subdomain>.workers.dev`.
Bind it to `provision.upcart.online` in the Cloudflare dashboard (Workers &
Pages → `upcart-provisioning` → Custom Domains), or add a `routes` entry in
`wrangler.toml` and redeploy.

Tenants' Stripe webhooks fire on the **tenant's own worker URL**, not on
the provisioning service. You have two options:

- **Shared webhook (simplest).** Register one endpoint in the Stripe
  dashboard at `https://upcart.online/webhooks/stripe` and point a DNS +
  worker route at the provisioning worker's `/webhooks/stripe` handler.
  *Not implemented in the current codebase — a shared webhook router
  does not exist yet.*
- **Per-tenant webhooks (current design).** When each tenant worker comes
  up, register a Stripe webhook endpoint at
  `https://<subdomain>.upcart.online/webhooks/stripe` in the dashboard
  (or via the Stripe API during provisioning, which is a TODO). Use one
  platform-level signing secret — it's shared across all endpoints in
  the same Stripe account.

For now: create **one** webhook in the Stripe dashboard pointing at the
first tenant you care about, listening for
`checkout.session.completed`, `payment_intent.succeeded`, and
`payment_intent.payment_failed`. Copy the signing secret (`whsec_…`) and:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
npm run deploy   # re-deploy so the secret is picked up
```

New tenants created after this point will have `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and `STRIPE_PUBLISHABLE_KEY` propagated
automatically (see `provisioning-service/src/routes/provision.ts` — all
three are set on the new tenant worker right after it's deployed).

### 2.7 Sanity check

```bash
curl https://provision.upcart.online/health
# → {"ok":true,"data":{"status":"healthy"}}

curl 'https://provision.upcart.online/provision/check-subdomain?name=demo'
# → {"ok":true,"data":{"available":true,"reason":null}}
```

---

## 3. Landing page

Pure static site. No build step.

1. Open `landing/index.html` and confirm (or edit) the `PROVISION_URL`
   constant near the top — it should point at Step 2.7's
   `https://provision.upcart.online`.
2. Deploy the `landing/` directory to any static host (Render static site,
   Cloudflare Pages, Netlify, S3 + CloudFront…).
3. Point `upcart.online` / `www.upcart.online` at the output.

The landing page is the only thing that talks to `POST /provision`, so if
you change `PROVISION_URL`, redeploy the landing page.

---

## 4. Admin dashboard

A tiny Node/Express server that serves the SPA and exposes
`/config` so the client knows which provisioning service to authenticate
against. One deployment serves *every* tenant.

```bash
cd admin-dashboard
npm install
cp .env.example .env
```

Fill in `.env`:

```
PORT=3000
PROVISION_URL=https://provision.upcart.online
BASE_DOMAIN=upcart.online
SIGNUP_URL=https://upcart.online
```

Deploy however you usually run Node (Render Web Service, Fly, Railway, a
$5 VPS). Point `dashboard.upcart.online` at it, and make sure that origin
is in the provisioning service's `CORS_ORIGINS`
(`wrangler.toml` → `[vars] CORS_ORIGINS`).

A merchant logs in at `dashboard.upcart.online` → the SPA calls
`POST /auth/login` on the provisioning service → the provisioning service
returns a JWT and that merchant's worker URL → every subsequent admin
request goes straight to the tenant worker.

---

## 5. Customer store

The shopper-facing HTML/CSS/JS site. One build, one deployment, serves
every tenant — the tenant's worker returns a `STORE_THEME` in
`/settings/public` and the storefront reads it at load time.

```bash
cd customer-store
cp .env.example .env
# edit .env: API_BASE_URL=https://<a-known-subdomain>.upcart.online
sh build.sh
```

`build.sh` writes `config.js` with `window.BST_API_BASE`. The storefront
reads this once and talks to the tenant's worker for everything.

There are two ways to host this in production:

- **Deploy once, point every subdomain at it.** In Cloudflare Pages, set
  a Workers Custom Domain per subdomain that routes `/` to the tenant
  worker and `/assets/*` to the static site. Tenant workers already serve
  `/settings/public`, `/products`, `/checkout/*`, and `/orders/*`, so a
  path-based split works.
- **Deploy per tenant.** `render.yaml` is set up for Render static sites;
  clone the deploy per merchant and set `API_BASE_URL` to that merchant's
  subdomain. Simpler but scales worse.

The current codebase does **not** include an automated storefront upload
step; don't look for `storefront:upload` or `STOREFRONT_BUNDLE_PREFIX`, they
don't exist.

---

## 6. Smoke test the full flow

1. Open the landing page (`https://upcart.online`). Fill out the signup
   wizard with a test subdomain (e.g. `demo1`) and a Stripe-test email.
2. The page polls `GET /provision/:id/status`. Watch
   `wrangler tail` in `provisioning-service/` — you should see:
   `creating_database → creating_storage → deploying_worker →
   configuring_domain → finalizing → active`.
3. `curl https://demo1.upcart.online/health` → `{"ok":true,…}`.
4. `curl https://demo1.upcart.online/products` → the seed product set by
   `runProvisioning` should appear.
5. Log in at `https://dashboard.upcart.online` with the credentials you
   signed up with.
6. From the dashboard, run Stripe Connect onboarding
   (`POST /connect/onboard` → returns an Account Link → merchant
   completes it in Stripe test mode → returns to the dashboard).
7. Shop on `https://demo1.upcart.online` → add the seed product to cart
   → checkout with Stripe test card `4242 4242 4242 4242`. The order
   should appear in the dashboard with a `paid` status after the webhook
   fires.

If any step fails, `wrangler tail -n upcart-store-<tenantId>` on the tenant
worker tells you why.

---

## 7. Common failure modes

| Symptom | Fix |
|---------|-----|
| `Stripe is not configured on this server` from a tenant | `STRIPE_SECRET_KEY` wasn't set on the provisioning worker when that tenant was created. Set it and re-run the signup, or manually `wrangler secret put STRIPE_SECRET_KEY -n upcart-store-<tenantId>`. |
| Webhook returns 400 "Invalid signature" | Signing secret mismatch. The platform webhook secret must match on every tenant worker and in the Stripe dashboard. Set via `wrangler secret put STRIPE_WEBHOOK_SECRET` on the provisioning worker and re-provision, or patch existing tenants manually. |
| Provisioning hangs at `deploying_worker` | The bundle is missing in R2. Re-run `npm run bundle:upload` in `provisioning-service/`. |
| `Worker bundle not found in R2: store-worker.js` | Same as above. |
| Signup returns 503 / CORS error from the dashboard | Dashboard origin isn't in the provisioning service's `CORS_ORIGINS` var (`wrangler.toml` → `[vars]`). |
| Tenant storefront 521/522 for ~60s after signup | DNS hasn't propagated yet. The provisioning pipeline waits 3–5 s; Cloudflare can take up to a minute. |
| Backend `npm run build` fails with `Missing entry point` | You're running it from the wrong folder; must be `backend/` with `src/index.ts` present. |

---

## 8. What you own vs. what Upcart owns

- **You (the platform):** the provisioning worker, the tenant registry D1,
  the R2 bundle bucket, the Stripe account (+ Connect platform), the base
  domain zone, the landing page, the dashboard, the customer-store
  assets.
- **Per tenant, auto-created:** a D1 database (`upcart-<tenantId>`), an R2
  bucket (`upcart-<tenantId>-images`), a Worker script
  (`upcart-store-<tenantId>`), a DNS record, a custom-domain binding.
- **Per tenant, merchant-owned:** their Stripe Connect account, their
  products, orders, discounts, balance, branding.

When you delete a tenant, also delete the four Cloudflare resources
(registry has their IDs) and the Stripe Connect account. There's no
automated sweeper yet.
