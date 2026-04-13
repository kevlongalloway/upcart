# Upcart SaaS — Remaining Work

This file tracks all remaining work to turn Upcart into a fully deployable SaaS platform.
Items are grouped by phase. Phase 1 (foundation) is complete in this session.

---

## ✅ Phase 1 — Foundation (Complete)

- [x] Platform worker (`platform/`) — signup, login, billing, store management, domains
- [x] Multi-tenant database schema (`platform/migrations/`)
- [x] Add `tenant_id` to backend tables (`backend/migrations/0004_add_multitenancy.sql`)
- [x] Tenant resolution middleware (`backend/src/middleware/tenant.ts`)
- [x] Stripe subscription integration with 30-day free trial
- [x] Onboarding UI — landing page + account dashboard (`onboarding/`)
- [x] Plan structure: Trial (free 30 days) → Basic $19.99/mo → Pro $49.99/mo

---

## 🔴 Phase 2 — Infrastructure Setup (Do Before Launching)

These are one-time setup tasks required before any real users can sign up.

### Cloudflare Setup
- [ ] Create the platform D1 database: `wrangler d1 create upcart-platform`
- [ ] Update `platform/wrangler.toml` with real `database_id`
- [ ] Run platform migrations: `cd platform && npm run db:migrate`
- [ ] Create backend D1 database: `wrangler d1 create upcart-store`
- [ ] Update `backend/wrangler.toml` with real `database_id` for both `DB` and `PLATFORM_DB`
- [ ] Update `backend/wrangler.toml` `database_name` from `blackstardb` → `upcart-store`
- [ ] Run backend migrations: `cd backend && npm run db:migrate`
- [ ] Set up wildcard subdomain routing in Cloudflare: `*.yourdomain.com → store worker`
- [ ] Set up `app.yourdomain.com → onboarding/platform UI`
- [ ] Set up `api.yourdomain.com → platform worker`
- [ ] Configure R2 bucket naming for multi-tenant (per-store buckets or shared with tenant prefix)

### Domain
- [ ] Purchase base domain (e.g. `upcart.store`, `upcart.shop`, `getupcart.com`)
- [ ] Replace all `yourdomain.com` placeholders in code with real domain:
  - `platform/wrangler.toml` → `BASE_DOMAIN`
  - `onboarding/index.html` → hardcoded URLs
  - `onboarding/dashboard.html` → hardcoded URLs
- [ ] Update `backend/src/middleware/tenant.ts` BASE_DOMAIN references

### Stripe Setup
- [ ] Create Stripe products + prices for Basic ($19.99/mo) and Pro ($49.99/mo)
- [ ] Set `STRIPE_BASIC_PRICE_ID` secret in platform worker
- [ ] Set `STRIPE_PRO_PRICE_ID` secret in platform worker
- [ ] Update `plans` table `stripe_price_id` column for basic and pro plans
- [ ] Configure Stripe webhook endpoint pointing to `api.yourdomain.com/billing/webhooks/stripe`
- [ ] Add these events to the webhook: `customer.subscription.*`, `invoice.payment_*`, `checkout.session.completed`
- [ ] Set `STRIPE_WEBHOOK_SECRET` in platform worker

### Platform Worker Secrets
```bash
cd platform
wrangler secret put JWT_SECRET           # openssl rand -hex 32
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_BASIC_PRICE_ID
wrangler secret put STRIPE_PRO_PRICE_ID
```

---

## 🟡 Phase 3 — Per-Tenant Admin Auth (Medium Priority)

Currently each store has admin credentials from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars.
In SaaS mode, each store needs independent admin credentials.

- [ ] Add `admin_password_hash` column to `stores` table
- [ ] On store creation, hash the platform user's password and store it as admin password
- [ ] Modify `backend/src/routes/adminLogin.ts` to look up credentials from `PLATFORM_DB` by `tenant_id`
- [ ] Remove global `ADMIN_USERNAME`/`ADMIN_PASSWORD` secrets (or keep as super-admin fallback)
- [ ] Platform dashboard: allow changing store admin password
- [ ] Single sign-on flow: platform login → generate short-lived store token → auto-login to admin dashboard

---

## 🟡 Phase 4 — Admin Dashboard Rebrand (Medium Priority)

The admin dashboard still has Blackstar branding. Needs to be tenant-agnostic.

- [ ] Remove all "Blackstar" text references from `admin-dashboard/public/app.js`
- [ ] Remove all "Blackstar" text references from `admin-dashboard/public/index.html`
- [ ] Remove all "Blackstar" text references from `admin-dashboard/public/style.css`
- [ ] Rename `blackstar_admin_token` → `upcart_admin_token` in sessionStorage key
- [ ] Rename `blackstardb` → `upcart-store` in `backend/wrangler.toml` (after migration)
- [ ] Rename `blackstarr2` → `upcart-images` in `backend/wrangler.toml` (after R2 migration)
- [ ] Remove the `IMG_1306.jpeg` file from admin dashboard
- [ ] Remove Shopify scraper (`customer-store/scraper.js`) — no longer needed for SaaS
- [ ] Remove GitHub Actions scraper workflow (`.github/workflows/scrape-products.yml`)
- [ ] Remove `customer-store/render.yaml` (deployment handled differently in SaaS)
- [ ] Remove `customer-store/products.json` static cache

### Admin Dashboard — Themes & Branding
- [ ] Add store logo upload to admin dashboard (shows in header + customer store)
- [ ] Add store color scheme picker (primary, accent, background)
- [ ] Auto light/dark mode toggle based on OS preference (`prefers-color-scheme`)
- [ ] Manual light/dark toggle in admin dashboard header
- [ ] Store these settings in a new `store_settings` column (JSON) in `stores` table
- [ ] Load settings from platform API on dashboard init

---

## 🟡 Phase 5 — Templating System (Medium Priority)

Customers need to customize their storefront appearance.

- [ ] Add 3-5 starter templates for the customer store (minimal, modern, bold, etc.)
- [ ] Store selected template in `store_settings.template`
- [ ] Template switcher in admin dashboard → "Appearance" section
- [ ] Per-template customization: font, colors, hero text, featured products
- [ ] Store template config in `store_settings` JSON column
- [ ] Customer store reads template config from platform API or injected via worker
- [ ] Advanced (later): Block-based page editor (like Shopify sections)

---

## 🟡 Phase 6 — Custom Domain Flow (Medium Priority)

Full custom domain support requires Cloudflare API integration.

- [ ] Implement DNS-over-HTTPS verification in `platform/src/routes/domains.ts`
  - Use `https://cloudflare-dns.com/dns-query?name=_upcart-verification.{domain}&type=TXT`
  - Auto-mark verified when TXT record matches expected value
- [ ] Use Cloudflare API to add custom hostname to worker route:
  - `POST /zones/{zone_id}/custom_hostnames` with `{hostname: custom_domain}`
  - Requires `CF_API_TOKEN` secret with Zone:Edit permission
- [ ] Add `CF_ZONE_ID` and `CF_API_TOKEN` secrets to platform worker
- [ ] Background polling job (Cloudflare Cron Trigger) to check unverified domains
- [ ] Email notification when domain is verified/failed
- [ ] SSL certificate status display in platform dashboard
- [ ] Platform dashboard shows DNS setup instructions with copy-to-clipboard

---

## 🟡 Phase 7 — Billing Polish (Medium Priority)

- [ ] Trial expiration email: 7 days, 3 days, 1 day before trial ends
  - Use Stripe's built-in trial reminder emails, or transactional email service (Resend, Postmark)
- [ ] Payment failure recovery: email with "Update payment method" link → Stripe portal
- [ ] Plan feature enforcement in backend:
  - Count products per tenant; block creation if over plan limit
  - Count monthly orders; warn at 80% of limit
- [ ] Grandfathered plans — ability to honor legacy pricing
- [ ] Annual billing option (2 months free)
- [ ] Pause subscription (store goes offline, billing stops)
- [ ] Delete account (cancel sub, scrub tenant data after 30-day grace period)
- [ ] Invoice history in platform dashboard
- [ ] Receipt emails via Stripe

---

## 🟠 Phase 8 — Store Isolation & Per-Tenant Resources (Higher Priority)

Currently the backend uses a single shared D1 database with tenant_id filtering.
This is fine initially but consider:

- [ ] Per-tenant R2 prefixes for image isolation (`{tenant_id}/images/`)
- [ ] Modify `backend/src/routes/images.ts` to prefix R2 keys with `tenant_id`
- [ ] Modify all DB queries in `backend/src/db/d1.ts` to filter by `tenant_id`
- [ ] Add `tenant_id` to all `INSERT` statements in `d1.ts`
- [ ] Add `tenant_id` index to products, orders, discounts tables
- [ ] Verify Stripe webhook events route to correct tenant (by `metadata.tenant_id`)
- [ ] Add `tenant_id` to Stripe Checkout Session metadata

---

## 🟠 Phase 9 — Deployment & Setup UX (High Priority)

- [ ] Interactive setup script (`platform/setup.mjs`) similar to `backend/setup.mjs`
  - Guides user through creating D1 database, setting secrets, configuring Stripe
- [ ] Store setup wizard in onboarding dashboard:
  - Step 1: Store name + subdomain
  - Step 2: Upload logo + set colors
  - Step 3: Add first product
  - Step 4: Configure payment (Stripe keys)
  - Step 5: Launch!
- [ ] Deployment docs (`DEPLOYMENT.md`) for self-hosting on Cloudflare
- [ ] Environment validation on worker startup (check required secrets are set)

---

## 🔵 Phase 10 — Analytics (Low Priority / Later)

- [ ] Basic analytics: page views, add-to-cart, checkout conversion
- [ ] Revenue dashboard: MRR, ARR, refunds
- [ ] Product performance: best sellers, inventory warnings
- [ ] Order trends: daily/weekly/monthly charts
- [ ] Customer data: new vs returning
- [ ] Use Cloudflare Analytics Engine (free, built into Workers) or Plausible

---

## 🔵 Phase 11 — Advanced Features (Future)

- [ ] Multiple admin users per store (team members)
- [ ] Role-based access control (admin, fulfillment, viewer)
- [ ] Customer accounts (sign in, order history)
- [ ] Abandoned cart recovery
- [ ] Email marketing integration (Klaviyo, Mailchimp)
- [ ] Product reviews
- [ ] Subscription products (recurring billing for customers)
- [ ] Digital downloads
- [ ] Multi-currency
- [ ] Tax calculations (Stripe Tax)
- [ ] Inventory alerts
- [ ] Bulk product import (CSV)

---

## Notes

- **BASE_DOMAIN placeholder**: All occurrences of `yourdomain.com` must be replaced once the domain is purchased.
- **Stripe Price IDs**: The `plans` table has `NULL` for `stripe_price_id` — update after creating Stripe products.
- **Shared vs isolated DBs**: Current design uses shared D1 with `tenant_id` filtering. This is fine for thousands of stores. For very high scale, consider per-store D1 databases (Cloudflare supports this).
- **Worker naming**: Platform worker is named `upcart-platform`. Store worker stays as `ecommaxxing` until rebranded.
