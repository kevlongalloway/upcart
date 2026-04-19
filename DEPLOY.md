# Upcart — End-to-End Deploy Guide (Test Mode)

This walks through deploying **every component** on Cloudflare in
chronological order, using Stripe **test keys** throughout. Follow it top to
bottom. Each step lists exactly which key to obtain, where to obtain it, and
where to put it.

The stack when you're done:

| Component | Hostname | Runtime | Purpose |
|---|---|---|---|
| Landing page | `upcart.online` / `www.upcart.online` | Cloudflare Pages (static) | Signup wizard (`landing/index.html`) |
| Provisioning service | `provision.upcart.online` | Cloudflare Worker | Creates tenants, Stripe billing, CF resources |
| Admin dashboard | `dashboard.upcart.online` | Node / Render / Pages | Central SPA — all merchants log in here |
| Tenant stores | `<sub>.upcart.online` | Cloudflare Worker (per tenant) | Customer storefront + admin API + assets |
| Backend template | n/a (R2 bundle) | Built once, deployed per tenant | Source of the tenant Worker |

> **Domain.** This guide assumes you own `upcart.online` and it is on a
> Cloudflare-managed zone. Swap `upcart.online` for your root domain
> throughout.

---

## 0. Prerequisites — accounts + keys

Create/collect these **before** touching the repo. Everything else flows from
them.

### 0.1 Cloudflare account

1. Sign up at <https://dash.cloudflare.com>.
2. Add the root zone (`upcart.online`). Update your registrar to Cloudflare's
   nameservers and wait for the zone to show **Active**.
3. From the zone overview page (right sidebar) copy:
   - **Account ID** → `CF_ACCOUNT_ID`
   - **Zone ID** → `CF_ZONE_ID`
4. Create an API token at <https://dash.cloudflare.com/profile/api-tokens> →
   **Create Custom Token** with these permissions:
   - **Account**: Workers Scripts **Edit**, D1 **Edit**, R2 Storage **Edit**,
     Workers Custom Domains **Edit**
   - **Zone** (`upcart.online`): DNS **Edit**, Workers Routes **Edit**
   - Scope: include your account and only the `upcart.online` zone.
   Save the token → `CF_API_TOKEN`.
5. Install the CLI locally:
   ```sh
   npm i -g wrangler
   wrangler login        # opens browser, OAuths once
   ```

### 0.2 Stripe account — **test mode**

1. Create an account at <https://dashboard.stripe.com/register>. Skip the
   activation flow — test mode works without it.
2. Make sure the top-left toggle reads **Test mode** (orange banner).
3. Go to <https://dashboard.stripe.com/test/apikeys>:
   - **Publishable key** → `STRIPE_PUBLISHABLE_KEY` (starts `pk_test_…`)
   - **Secret key** (reveal it) → `STRIPE_SECRET_KEY` (starts `sk_test_…`)
4. **Do nothing else in Stripe.** The provisioning service auto-creates the
   subscription Product + Price on the first signup and caches their IDs in
   D1 — zero dashboard clicks required.
5. Enable **Stripe Connect** for later use (merchants will onboard from their
   dashboard after their store is live): Dashboard → **Connect** → **Get
   started** → pick **Standard** accounts. This is only needed once.
6. (Optional, later) Webhook secret for the tenant backend's
   `/api/webhooks/stripe` endpoint — set up in §6.2.

### 0.3 Local tooling

- Node ≥ 20 and `npm` — for every package here.
- `git`.
- An editor. That's it.

---

## 1. Clone + install

```sh
git clone <your fork> upcart
cd upcart
npm --prefix backend              install
npm --prefix provisioning-service install
npm --prefix admin-dashboard      install
# landing/ + customer-store/ are static; nothing to install.
```

---

## 2. Deploy the backend bundle to R2 (tenant Worker template)

The provisioning service doesn't rebuild the backend per tenant — it fetches
the **same** compiled bundle from R2 and deploys it as each tenant's Worker.
Re-upload the bundle whenever you want tenants to pick up backend changes.

### 2.1 Build the bundle

```sh
cd backend
npm run build          # emits dist/index.js
```

### 2.2 Create R2 bucket that holds the bundle + storefront

```sh
wrangler r2 bucket create upcart-worker-bundles
```

Upload the compiled backend:

```sh
wrangler r2 object put upcart-worker-bundles/store-worker.js \
  --file dist/index.js --remote
```

The object key `store-worker.js` is what the provisioning service's
`WORKER_BUNDLE_KEY` var points at.

---

## 3. Upload the storefront assets to R2

Each tenant Worker serves the same HTML/JS as static assets. We upload them
once to the **same** `upcart-worker-bundles` bucket under a `storefront/`
prefix, and the provisioning service attaches them to every new tenant's
Worker via the Workers Static Assets API.

```sh
cd ../customer-store
sh build.sh            # generates config.js with an EMPTY API base ("")
                       #   → fetches resolve to the current origin, i.e. the
                       #     tenant's own Worker. Do NOT set API_BASE_URL.

cd ../provisioning-service
npm run storefront:upload
```

Re-run both commands whenever you change anything in `customer-store/`.

---

## 4. Deploy the provisioning service

This is the Worker at `provision.upcart.online` that the landing page, the
dashboard, and your future admin tooling all talk to.

### 4.1 Create the D1 registry

```sh
cd provisioning-service
wrangler d1 create upcart-provisioning-db
```

Copy the `database_id` from the output into `wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "upcart-provisioning-db"
database_id   = "<paste the UUID from the CLI output>"
```

Apply every migration (includes the new billing migration `0005`):

```sh
wrangler d1 migrations apply upcart-provisioning-db --remote
```

### 4.2 Fill in `wrangler.toml` public vars

Edit `provisioning-service/wrangler.toml`:

```toml
[vars]
BASE_DOMAIN              = "upcart.online"
WORKER_SCRIPT_PREFIX     = "upcart-store"
WORKER_BUNDLE_KEY        = "store-worker.js"
STOREFRONT_BUNDLE_PREFIX = "storefront/"
CORS_ORIGINS             = "https://upcart.online,https://www.upcart.online,https://dashboard.upcart.online"

# ── Stripe (TEST mode) ──
STRIPE_PUBLISHABLE_KEY   = "pk_test_...your test publishable key..."
TRIAL_DAYS               = "14"
PLATFORM_PRODUCT_NAME    = "Upcart Subscription"
PLATFORM_PRICE_AMOUNT    = "2900"   # $29.00 USD — smallest unit
PLATFORM_PRICE_CURRENCY  = "usd"
```

### 4.3 Set secrets

```sh
wrangler secret put CF_ACCOUNT_ID       # paste from §0.1
wrangler secret put CF_API_TOKEN        # paste from §0.1
wrangler secret put CF_ZONE_ID          # paste from §0.1
wrangler secret put STRIPE_SECRET_KEY   # paste sk_test_… from §0.2
```

### 4.4 Deploy

```sh
wrangler deploy
```

### 4.5 Bind it to `provision.upcart.online`

In the Cloudflare dashboard → **Workers & Pages → upcart-provisioning →
Triggers → Custom Domains → Add Custom Domain** → `provision.upcart.online`.
Cloudflare creates the DNS record + TLS cert automatically. Wait ~30 seconds
and hit `https://provision.upcart.online/` — you should get a Hono 404, which
means it's live.

---

## 5. Deploy the central admin dashboard

All merchants share a single dashboard deployment at
`dashboard.upcart.online`. At boot it calls `GET /config` to find the
provisioning URL; after login the SPA talks directly to the merchant's tenant
Worker.

### 5.1 Choose a host

The dashboard is a tiny Express server (`admin-dashboard/server.js`) that
serves `public/`. Deploy it anywhere — Render, Fly, Railway, a VPS, or
Cloudflare Pages with a Functions shim. Simplest is **Render**:

1. Push this repo to GitHub.
2. Render → **New → Web Service** → point at `admin-dashboard/`.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Env vars:
   - `PROVISION_URL=https://provision.upcart.online`
   - `BASE_DOMAIN=upcart.online`
   - `SIGNUP_URL=https://upcart.online`
6. Custom domain: `dashboard.upcart.online` (add a CNAME to the Render host
   in Cloudflare DNS, proxied).

### 5.2 Smoke test

Open `https://dashboard.upcart.online/config` — you should see JSON with the
three URLs above.

---

## 6. Deploy the landing page

The landing page (`landing/index.html`) is fully static. Deploy on Cloudflare
Pages so it lives at the apex domain.

### 6.1 Create the Pages project

```sh
cd ../landing
# Option A — Git-backed:
#   Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
#   Build command: (none)  Output directory: .
# Option B — direct upload:
wrangler pages deploy . --project-name upcart-landing
```

### 6.2 Bind custom domains

In the Pages project → **Custom domains**, add both:

- `upcart.online`
- `www.upcart.online`

### 6.3 Optional — override the provisioning URL per-environment

The landing page hard-codes `https://provision.upcart.online`. To point at a
staging URL without a rebuild, add these `<meta>` tags in the page's `<head>`:

```html
<meta name="upcart-provision-url"  content="https://provision-staging.upcart.online">
<meta name="upcart-dashboard-url"  content="https://dashboard-staging.upcart.online">
```

---

## 7. First-signup smoke test

You should now be able to run the full flow end-to-end **without any Stripe
dashboard intervention**:

1. Go to `https://upcart.online`.
2. **Step 1 — Store details:** pick a subdomain. The availability check hits
   `provision.upcart.online/provision/check-subdomain`.
3. **Step 2 — Admin account:** email / username / password.
4. **Step 3 — Free trial + card:** the page calls
   `POST /provision/billing-intent`, which creates a Stripe Customer + a
   SetupIntent. Stripe Elements mounts inside the card field.
   - Use test card **`4242 4242 4242 4242`**, any future expiry, any CVC, any ZIP.
   - Click **Start free trial**. Stripe.js confirms the SetupIntent; nothing
     is charged.
5. The browser posts to `POST /provision` with
   `{ store, admin, billing: { customer_id, setup_intent_id } }`.
6. The provisioning service:
   - Verifies the SetupIntent succeeded.
   - Looks up `stripe_price_id` in `platform_settings` (D1). **First signup
     only**: it creates the Product + Price in Stripe and caches the IDs.
   - Creates a **trialing** Subscription (trial\_end = now + 14 days).
   - Inserts the tenant row.
   - Kicks off async provisioning (D1 → R2 → Worker + assets → DNS +
     binding → `/setup` call → starter product seed).
7. The page polls `GET /provision/<id>/status` every 3s and advances the
   progress bar.
8. On success you get two links: the store (`https://<sub>.upcart.online`)
   and the dashboard (`https://dashboard.upcart.online`).

Verify in Stripe → <https://dashboard.stripe.com/test/subscriptions>:
- One Customer with the email you signed up with.
- One Subscription, status **trialing**, price `$29.00 / month`.

Verify in Cloudflare:
- **Workers & Pages** lists a new Worker named `upcart-store-<tenantId>`.
- **R2** lists a new bucket `upcart-<tenantId>-images`.
- **D1** lists a new database `upcart-<tenantId>`.
- **DNS** lists an AAAA record for `<sub>.upcart.online` → `100::`, proxied.

---

## 8. Customer store transactions — already set up

Nothing more to configure for customer checkout. Each tenant Worker inherits
the platform Stripe keys during provisioning
(`provisioning-service/src/routes/provision.ts`):

- `STRIPE_PUBLISHABLE_KEY` — in the Worker's plain-text vars (line 600).
- `STRIPE_SECRET_KEY` — set as a Worker secret (line 620).

When a customer checks out on `<sub>.upcart.online`, the tenant backend uses
those keys to create a Stripe Checkout Session. In test mode, the same
`4242 4242 4242 4242` card works.

### 8.1 Optional — tenant Stripe webhook secret

The tenant backend listens at `<sub>.upcart.online/api/webhooks/stripe` so
Stripe can notify it when a checkout completes. To enable:

1. Stripe dashboard → <https://dashboard.stripe.com/test/webhooks> → **Add
   endpoint**. URL: `https://<sub>.upcart.online/api/webhooks/stripe`. Events:
   `checkout.session.completed`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`.
2. Copy the **Signing secret** (`whsec_…`).
3. `wrangler secret put STRIPE_WEBHOOK_SECRET --name upcart-store-<tenantId>`

This is a one-per-tenant step; if you skip it, checkouts still work but
orders are reconciled via Stripe's hosted success page instead of a webhook.

### 8.2 Optional — merchant payouts (Stripe Connect)

After a merchant's store is live, they can onboard Stripe Connect from the
admin dashboard (Settings → Payouts). The provisioning service's
`/connect/*` routes handle the OAuth flow using the same platform
`STRIPE_SECRET_KEY` — no extra config needed.

---

## 9. Going live (switching to real money)

When you're ready to leave test mode:

1. Activate your Stripe account (business details + bank).
2. Flip the Stripe dashboard toggle to **Live mode**.
3. Grab the live keys at <https://dashboard.stripe.com/apikeys> (`pk_live_…`
   + `sk_live_…`).
4. Update the provisioning service:
   ```sh
   cd provisioning-service
   # in wrangler.toml [vars], change STRIPE_PUBLISHABLE_KEY to pk_live_…
   wrangler secret put STRIPE_SECRET_KEY    # paste sk_live_…
   wrangler deploy
   ```
5. **Important:** the `platform_settings` D1 rows still reference the
   test-mode `prod_…`/`price_…` IDs. Clear them so the first live signup
   bootstraps live equivalents:
   ```sh
   wrangler d1 execute upcart-provisioning-db --remote \
     --command "DELETE FROM platform_settings WHERE key IN ('stripe_product_id','stripe_price_id');"
   ```
6. New tenants provisioned after this point serve live checkout. Existing
   tenants still have the test-mode secrets baked into their Worker
   environment — re-deploy them if you need to migrate:
   `wrangler secret put STRIPE_SECRET_KEY --name upcart-store-<tenantId>`
   (and update `STRIPE_PUBLISHABLE_KEY` in their vars).

---

## 10. Re-deploy cheatsheet

| You changed… | Run |
|---|---|
| `backend/src/**` | `cd backend && npm run build && wrangler r2 object put upcart-worker-bundles/store-worker.js --file dist/index.js --remote` — **only new tenants** pick it up automatically; re-deploy existing tenants by re-running the provisioning flow or pushing a bulk-update tool. |
| `customer-store/**` | `cd customer-store && sh build.sh && cd ../provisioning-service && npm run storefront:upload` — new tenants get the new storefront; existing tenants need a re-upload (`cf.uploadAssets(...)`). |
| `provisioning-service/src/**` | `cd provisioning-service && wrangler deploy` |
| `provisioning-service/migrations/*.sql` | `wrangler d1 migrations apply upcart-provisioning-db --remote` |
| `landing/**` | `cd landing && wrangler pages deploy . --project-name upcart-landing` |
| `admin-dashboard/public/**` | Redeploy wherever you host it (Render auto-deploys on git push). |

---

## 11. Keys & variables — one-page reference

| Name | Where | Source | Value (test mode) |
|---|---|---|---|
| `CF_ACCOUNT_ID` | provision Worker secret | Cloudflare dashboard → zone sidebar | your account UUID |
| `CF_API_TOKEN` | provision Worker secret | <https://dash.cloudflare.com/profile/api-tokens> | scoped token (§0.1) |
| `CF_ZONE_ID` | provision Worker secret | Cloudflare zone overview sidebar | zone UUID |
| `STRIPE_SECRET_KEY` | provision Worker secret (+ propagated to tenant Workers) | <https://dashboard.stripe.com/test/apikeys> | `sk_test_…` |
| `STRIPE_PUBLISHABLE_KEY` | provision Worker var (+ propagated to tenant Workers) | same | `pk_test_…` |
| `BASE_DOMAIN` | provision var | you | `upcart.online` |
| `WORKER_SCRIPT_PREFIX` | provision var | you | `upcart-store` |
| `WORKER_BUNDLE_KEY` | provision var | you | `store-worker.js` |
| `STOREFRONT_BUNDLE_PREFIX` | provision var | you | `storefront/` |
| `TRIAL_DAYS` | provision var | you | `14` |
| `PLATFORM_PRODUCT_NAME` | provision var | you | `Upcart Subscription` |
| `PLATFORM_PRICE_AMOUNT` | provision var | you | `2900` (cents) |
| `PLATFORM_PRICE_CURRENCY` | provision var | you | `usd` |
| `CORS_ORIGINS` | provision var | you | landing + dashboard + www |
| `PROVISION_URL` | dashboard env | you | `https://provision.upcart.online` |
| `BASE_DOMAIN` | dashboard env | you | `upcart.online` |
| `SIGNUP_URL` | dashboard env | you | `https://upcart.online` |
| `STRIPE_WEBHOOK_SECRET` | tenant Worker secret *(optional)* | per-tenant webhook in Stripe | `whsec_…` |
| `JWT_SECRET` | tenant Worker secret *(auto-generated)* | provisioning service generates a 64-hex-char random value per tenant | — |

Everything not in this table is hard-coded or derived; you shouldn't need to
touch it.

---

## 12. Troubleshooting

- **`billing-intent` returns 503 "Platform billing is not configured"** —
  `STRIPE_SECRET_KEY` or `STRIPE_PUBLISHABLE_KEY` wasn't set on the
  provisioning Worker. Re-run §4.2/§4.3 and redeploy.
- **Landing page shows "Stripe.js did not load"** — ad-blocker. Disable it or
  whitelist `js.stripe.com`.
- **Provisioning stalls at "Deploying store backend"** — the R2 bundle is
  missing. Re-run §2.
- **Tenant Worker 404s for `/`** — no storefront assets uploaded. Re-run §3.
- **Subscription shows `incomplete` instead of `trialing`** — the SetupIntent
  didn't actually succeed; usually means the test card was declined. Re-try
  signup with `4242 4242 4242 4242`.
- **Want to nuke test tenants** — delete the Worker (`wrangler delete
  upcart-store-<id>`), D1 (`wrangler d1 delete upcart-<id>`), R2 bucket, DNS
  record, and the `tenants` row. Cancel the Stripe subscription from the
  test dashboard.
