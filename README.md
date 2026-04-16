# Upcart — Multi-tenant Serverless E-commerce Platform

Upcart lets a merchant sign up on a landing page and, a few minutes later, have
a fully-isolated e-commerce store — their own admin dashboard, their own
storefront on a branded subdomain, their own database, their own Stripe
Connect account. All serverless, all on Cloudflare's edge.

---

## Platform overview

```
                                 upcart.online (landing)
                                        │
                                        ▼
                          ┌─────────────────────────────┐
                          │   provisioning-service      │   Cloudflare Worker
                          │   (Hono + D1 tenant registry)│
                          └─────────────────────────────┘
                                        │
                creates per-tenant:  D1 db  •  R2 bucket  •  Worker  •  DNS
                                        │
                                        ▼
                       <subdomain>.upcart.online
                     ┌────────────────┬─────────────────┐
                     │                │                 │
            customer-store      admin-dashboard     backend
            (static)            (Express SPA)    (Cloudflare Worker)
                 └──────────── public API ──────┘
                             + admin API (JWT)
                             + Stripe webhook
                             + Stripe Connect (per-merchant payouts)
```

Every merchant gets their own stack; the shared surfaces are the landing page
and the provisioning service.

---

## Repository layout

| Folder | What it is | Docs |
|--------|------------|------|
| [`backend/`](./backend) | Core e-commerce API. Cloudflare Worker + Hono + D1/MongoDB. Handles products, orders, discounts, Stripe checkout + webhooks, Stripe Connect, shipping labels, R2 image uploads, admin auth. | [`README`](./backend/README.md), [`API.md`](./backend/API.md), [`ADMIN_API.md`](./backend/ADMIN_API.md) |
| [`admin-dashboard/`](./admin-dashboard) | Merchant-facing admin SPA. Vanilla JS + Bootstrap, served by a tiny Express wrapper so it can expose `WORKER_URL` to the browser via `/config`. | [`README`](./admin-dashboard/README.md) |
| [`customer-store/`](./customer-store) | Shopper-facing storefront. Static HTML/CSS/JS with five theme presets. `build.sh` writes the backend URL into `config.js` at deploy time. | [`README`](./customer-store/README.md) |
| [`landing/`](./landing) | Public signup wizard. Pure static site that talks to the provisioning service. | [`README`](./landing/README.md) |
| [`provisioning-service/`](./provisioning-service) | Cloudflare Worker that spins up a new tenant (D1 + R2 + Worker + DNS + Custom Domain) in response to a signup. | [`README`](./provisioning-service/README.md) |

---

## Tech stack

| Area | Tech |
|------|------|
| Backend runtime | Cloudflare Workers |
| Backend framework | [Hono](https://hono.dev) |
| Backend language | TypeScript |
| Databases | Cloudflare D1 (SQLite) or MongoDB Atlas |
| Object storage | Cloudflare R2 (product images) |
| Payments | Stripe Checkout Sessions, Payment Intents, Stripe Connect (Express accounts) |
| Shipping (optional) | EasyPost |
| Admin dashboard | Vanilla JS + Bootstrap 5, served via Express |
| Customer store | Vanilla HTML/CSS/JS, Stripe.js |
| Landing page | Static HTML/CSS |
| Provisioning | Cloudflare Worker (Hono) + Cloudflare REST API |

---

## Development setup

Clone the repo and install dependencies per service. There is no monorepo
tooling; each folder is its own npm project.

```bash
git clone <repo> upcart
cd upcart

# Backend
cd backend && npm install && cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Stripe + admin credentials
npm run dev          # http://localhost:8787

# Admin dashboard (in a new terminal)
cd admin-dashboard && npm install && cp .env.example .env
# Edit .env: WORKER_URL=http://localhost:8787
npm run dev          # http://localhost:3000

# Customer store (in a new terminal)
cd customer-store
API_BASE_URL=http://localhost:8787 sh build.sh
python3 -m http.server 8080   # http://localhost:8080

# Provisioning + landing are only needed if you want to test the signup flow.
```

---

## Deployment

Each service deploys independently. The quick version:

| Service | Platform | How |
|---------|----------|-----|
| `backend` | Cloudflare Workers | `cd backend && npm run setup && npm run deploy` (or run migrations + `wrangler deploy` manually) |
| `admin-dashboard` | Render (Web Service) or any Node host | `npm start`, with `WORKER_URL` set |
| `customer-store` | Render static / Cloudflare Pages | `sh build.sh` with `API_BASE_URL` in env |
| `landing` | Render static / Cloudflare Pages | No build step; edit `PROVISION_URL` in `index.html` if you host the provisioning service yourself |
| `provisioning-service` | Cloudflare Workers | `npm run db:create && npm run db:migrate && npm run r2:create && npm run bundle:upload && npm run deploy`, plus `wrangler secret put` for `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_ZONE_ID` |

See each folder's `README.md` for the full per-service playbook.

---

## Environment variables at a glance

| Service | Var | Purpose |
|---------|-----|---------|
| backend | `STRIPE_SECRET_KEY` | Stripe API key |
| backend | `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| backend | `JWT_SECRET` | Admin JWT signing |
| backend | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Env-based admin fallback (DB account takes precedence once onboarding runs) |
| backend | `MONGODB_URI` | Only when `DB_ADAPTER = "mongodb"` |
| backend | `EASYPOST_API_KEY` | Shipping label generation (optional) |
| backend | `CORS_ORIGINS` | Comma-separated allowed frontends |
| backend | `STRIPE_PUBLISHABLE_KEY` | Returned to storefront; not secret |
| backend | `R2_PUBLIC_URL` | Public URL of your image bucket |
| admin-dashboard | `WORKER_URL` | Backend URL exposed via `GET /config` |
| customer-store | `API_BASE_URL` | Backend URL, baked into `config.js` |
| provisioning-service | `CF_ACCOUNT_ID` / `CF_API_TOKEN` / `CF_ZONE_ID` | Cloudflare API credentials for provisioning |

Copy each service's `.dev.vars.example` / `.env.example` and fill in values
before running or deploying.

---

## Features

- Per-merchant isolation — every tenant gets their own D1 database, R2 bucket, Worker, and subdomain.
- Self-serve onboarding via the landing page + provisioning service.
- Product management (CRUD, inventory, images on R2, Stripe product sync).
- Stripe checkout (hosted redirect + Payment Request Button for Apple/Google Pay).
- Stripe Connect (Express) — each merchant onboards their own bank account; the platform transfers funds via balance transactions and payouts.
- Discount codes (percent, fixed, free-shipping; date range, usage limits, per-product or global).
- Order management with fulfillment tracking + EasyPost shipping labels.
- Admin dashboard with JWT auth and first-run setup wizard.
- Five storefront themes (`mono`, `minimal`, `boutique`, `bold`, `studio`) applied via CSS custom properties with no FOUC.
- MongoDB alternative to D1 for larger catalogs.

---

## Security checklist (before going live)

- [ ] Set a strong `ADMIN_PASSWORD` or complete the onboarding wizard to create a DB-backed admin account.
- [ ] Use **live** Stripe keys + `whsec_live_...` webhook secret; re-verify the webhook endpoint in the Stripe dashboard.
- [ ] Set `CORS_ORIGINS` to exact origins (no wildcards) on the backend and `CORS_ORIGINS` on the provisioning service.
- [ ] Enable `CSRF_ENABLED=true` on the backend in production.
- [ ] Rotate `JWT_SECRET` to a 32-byte random value (`openssl rand -hex 32`).
- [ ] Restrict the provisioning Cloudflare API token to the minimum scopes listed in `provisioning-service/README.md`.
- [ ] Add domain verification file for Apple Pay at `.well-known/apple-developer-merchantid-domain-association` on every storefront domain that accepts Apple Pay.
- [ ] Review `wrangler.toml` for leftover placeholder values (`REPLACE_ME`, `REPLACE_WITH_YOUR_D1_DATABASE_ID`).

---

## Known gaps

These are platform-wide issues worth tracking:

- **No automated tests anywhere.** Every service is manually verified. Critical paths (checkout, Stripe webhook, provisioning pipeline, admin auth) should have coverage before scaling.
- **No CI.** No GitHub Actions / equivalent runs `tsc --noEmit` or `wrangler deploy --dry-run` on PRs.
- **No shared linter/formatter.** TypeScript config differs across services; no root ESLint/Prettier.
- **Backend DB name is hard-coded** to `blackstardb` in `wrangler.toml` and package.json migration scripts. Works, but should be parameterized per environment.
- **Provisioning cleanup is manual.** Failed tenants leave orphaned D1/R2/DNS resources.
- **No rate limiting** on the provisioning service's `POST /provision` — it creates billable Cloudflare resources unauthenticated.
- **`customer-store/success.html`** doesn't yet render real order data; it's a placeholder. See [`customer-store/TODO.md`](./customer-store/TODO.md).
- **No LICENSE file.** Add one before open-sourcing.
- **Admin dashboard is a 2.5k-line single JS file.** Splitting by view would make maintenance easier.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Admin dashboard shows "Configuration Error" | `WORKER_URL` env var is missing on the dashboard host |
| Storefront shows "Error loading products" | `API_BASE_URL` was empty at build time, or backend `CORS_ORIGINS` doesn't include the storefront origin |
| Checkout redirect 4xxs | Stripe key mismatch between dashboard and backend, or products haven't been synced to Stripe |
| Signup hangs on "Provisioning…" for 3 min | Check provisioning Worker logs (`wrangler tail`); usually a Cloudflare API token scope missing |
| Apple Pay button doesn't appear | Domain not verified in Stripe, or `.well-known` file not hosted on the storefront |

Tail logs with `wrangler tail` from `backend/` or `provisioning-service/`.

---

## Docs

- Backend public API: [`backend/API.md`](./backend/API.md)
- Backend admin API: [`backend/ADMIN_API.md`](./backend/ADMIN_API.md)
- Each service's `README.md` has the per-service deploy + config details.
