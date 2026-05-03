# Upcart — Production Readiness TODO

> Last updated: 2026-05-03
> **Re-audited on branch `claude/fix-store-customization-0DQf8` — overall readiness: ~58/100.**
> Payment + identity verification, trial billing, suspension, transactional emails,
> and the visual editor are now all wired up and exercised end-to-end. **Four P0
> blockers from the 2026-04-28 audit are still open and individually break revenue
> for every live merchant** — see [P0 Blockers](#p0-blockers--still-open) below.
>
> **Session update (2026-05-03):** Consolidated the duplicate "Customize" + "Templates"
> tabs into a single React store editor at `/store-editor/`; removed the legacy
> `CustomizeView` (~410 LOC) and orphan CSS (~135 LOC) that wrote keys the storefront
> renderer no longer reads. Marked `/settings/public` as `Cache-Control: no-store`
> so saves are visible on the next page load. See [Session Updates](#session-updates).

---

## P0 BLOCKERS — still open

> Each one independently breaks revenue or basic correctness for every live tenant.

### A. Per-tenant Stripe webhook endpoint never registered
- [ ] In `runProvisioning()` (after Worker deploy), call Stripe `POST /webhook_endpoints` with `url: https://${hostname}/webhooks/stripe` and events `["checkout.session.completed", "payment_intent.succeeded", "payment_intent.payment_failed"]`
- [ ] Store `webhook_endpoint.id` on the tenant record for deprovisioning cleanup
- [ ] Set the per-tenant signing secret on the worker via `cf.setWorkerSecret(workerName, "STRIPE_WEBHOOK_SECRET", perTenantSecret)` (overrides the platform-wide secret currently set on every tenant at `provision.ts:838`)
- **Why this matters:** customer purchases succeed (money collected) but `checkout.session.completed` never reaches the tenant worker → orders never created in D1 → merchant sees zero orders. Verified absent: `grep webhook_endpoints` returns no hits in `provisioning-service/src/`.

### B. R2 bucket public access not automated — product images 403 on every new store
- [ ] Either (a) call `cf.setR2BucketPublic(bucketName)` immediately after `createR2Bucket()` in `provision.ts:733-736`, or (b) add a `/images/:key` route on the tenant worker that streams from a private `IMAGES` R2 binding (`c.env.IMAGES.get(key)`) — preferred long-term
- [ ] If (b): swap `R2_PUBLIC_URL` (`provision.ts:783`) to `https://${hostname}/images` and remove the public `pub-*.r2.dev` URL entirely
- **Verified:** `backend/src/routes/images.ts:45` returns the public `.r2.dev` URL, but the bucket is never made public during provisioning. Every new store ships with broken product images until someone manually toggles the bucket.

### C. `STRIPE_PRICE_ID` is empty — subscription / trial never created
- [ ] Set `STRIPE_PRICE_ID` in `provisioning-service/wrangler.toml:64` (currently `""`) to a real recurring Stripe Price ID
- [ ] Verify subscription creation runs end-to-end (`provision.ts:1024` short-circuits if unset; `provision.ts:1067-1070` logs a warning and skips)
- **Verified:** all the trial/subscription scaffolding is already coded (Stripe customer + subscription + trial_end + payment_method attach). It just never runs because the price ID is empty.

### D. `store_settings` not fully seeded at provisioning
- [ ] Currently only `page_sections` is seeded (`provision.ts:722-728`). Also seed:
  - `key="store_name"` → `input.store.name`
  - `key="theme"` → `input.store.theme`
  - `key="country"` → `input.store.country`
  - `key="currency"` → `input.store.currency`
- **Why this matters:** the theme picked at signup has no effect (the storefront falls back to the editor's default schema), and the Stripe Connect onboarding form (`backend/src/routes/connect.ts:77-78`) reads `store_name` / `country` from `store_settings` — they currently come back empty so the Connect account is created with no business profile.

---

## P1 SECURITY — still open

### E. `ADMIN_PASSWORD_HASH` shipped as a plain-text env var
- [ ] Remove from the `vars` object at `provisioning-service/src/routes/provision.ts:795`
- [ ] Add `await cf.setWorkerSecret(workerName, "ADMIN_PASSWORD_HASH", adminPasswordHash)` alongside `JWT_SECRET` (line 827)
- **Verified:** anyone with Cloudflare dashboard read-only access can currently read the PBKDF2 hash and run an offline crack.

### F. `/debug` route publicly accessible on every tenant worker
- [ ] `backend/src/index.ts:91` — move `app.route("/debug", debug)` below the `adminAuthMiddleware()` block (line 127) or delete entirely for production builds
- **Verified:** `routes/debug.ts` exposes `ADMIN_USERNAME` (full unmasked), Stripe publishable key hint, D1 row counts, and R2 binding status to any unauthenticated HTTP request.

### G. Stripe Connect account created lazily, not at provisioning
- [ ] **Status: deferred / partially-acceptable.** Connect Express account is currently created on first call to `POST /connect/onboard` (`backend/src/routes/connect.ts:80-92`) rather than at signup. This works but means the merchant's first dashboard visit triggers a synchronous Stripe call. Decide: keep lazy (acceptable) or move to provisioning (cleaner, faster first dashboard load).
- [ ] If kept lazy: pre-fill form values still need item D (store_name + country must be in `store_settings`).

### H. Two webhook architectures — neither fully implemented
- [ ] Pick one and document it:
  - **Option A (recommended):** per-tenant webhook endpoints (item A above). Tenant worker handles checkout events. Platform handles subscription/Connect events.
  - **Option B:** single platform webhook with internal forwarding by `metadata.tenant_id` to `store_url/webhooks/stripe`.
- **Verified:** platform webhook (`provisioning-service/src/routes/webhooks.ts`) handles subscription/Connect events. Tenant webhooks have a handler (`backend/src/routes/webhooks.ts`) but no Stripe endpoint registered for them — checkout events are dropped.

### I. `STORE_MIGRATIONS` constant drifts from `backend/migrations/*.sql`
- [ ] Add a CI step (or a build-time codegen) that diffs the inline `STORE_MIGRATIONS` array in `provision.ts:63-159` against the concatenated content of `backend/migrations/*.sql`
- **Why this matters:** today the array is hand-maintained — every new migration file requires a separate edit to `provision.ts`, and there's no test that catches drift.

---

## CRITICAL — Must ship before open beta

### 1. Pre-Provisioning Payment Verification ($1 Auth Charge)
- [x] Stripe Payment Intent (`amount: 100, capture_method: manual`) before any provisioning — `provision.ts:371-380`
- [x] Provision only after the $1 auth succeeds — `provision.ts:438-446` returns 402 on decline
- [x] Capture + refund after successful provisioning — `provision.ts:1002-1017`
- [x] Card decline blocks provisioning
- [x] `payment_method_id` stored on tenant record — column added in `0006_add_payment_method.sql`
- [x] Gate: no provisioning without a valid payment method on file

### 2. Identity Verification Before Provisioning
- [x] Email verification OTP (Resend) blocks provisioning — `provision.ts:408-421`
- [x] Phone (SMS) OTP via Twilio — `provision.ts:278-291` (channel selection)
- [x] `email_verified_at` / `phone_verified_at` columns — `0007_verification.sql`
- [x] Resend rate limiting (4 sends per identifier per 10 min) — `provision.ts:259-266`
- [x] OTP expiry (10 minutes) — `provision.ts:269`

### 3. Untrusted Store / SSL Certificate Issues
- [ ] Confirm Cloudflare Universal SSL covers `*.upcart.online` end-to-end (probably already true on the Cloudflare side; needs an explicit test)
- [ ] For custom domains (Item 15 below): drive Cloudflare Custom Hostnames API + poll `ssl_status = active`
- [ ] Confirm `ssl_status = active` before marking tenant live (today the active flip happens after `/health` probe but doesn't gate on SSL)
- [ ] Add CAA DNS records on `upcart.online` to pin certificate authority
- [ ] Apple Pay / Google Pay domain verification file (covered under Item 18)

---

## HIGH PRIORITY — Subscription & Billing

### 4. Tenant Subscription Plans
- [x] Plan tiers defined — `0008_subscriptions.sql`
- [x] `subscriptions` table with all required columns
- [x] Stripe subscription created after $1 auth — `provision.ts:1024-1071` *(blocked by P0 item C above)*
- [x] Saved `payment_method_id` attached as default — `provision.ts:1033-1034, 1046-1047`

### 5. Free Trial (3 Months)
- [x] 3-month free trial granted automatically — `provision.ts:1039` sets `trial_end = now + 90 days`
- [x] Full feature access during trial
- [x] First charge handled by Stripe subscription cycle *(blocked until P0-C is set)*

### 6. Trial Expiry Notices
- [x] 30d / 7d / 1d / expired-day reminder emails — `jobs/trial-expiry.ts:36-51`
- [x] Cloudflare Cron Trigger — `wrangler.toml:24-26` (`crons = ["0 10 * * *"]`)

### 7. Unpaid / Delinquent Tenant Handling
- [x] `invoice.payment_failed` → tenant `payment_failed` + email — `webhooks.ts:168-208`
- [x] After 3 failures or grace expiry → suspended — `webhooks.ts:204-207`
- [x] Suspended tenants return HTML 402 page (no crash) — `backend/src/index.ts:47-82`
- [x] 7-day grace period — `webhooks.ts:57`
- [x] Recovery on `invoice.paid` → `restoreTenant()` — `webhooks.ts:210-231`
- [ ] **Hard delete after 30 days suspended** — comment at `jobs/trial-expiry.ts:2` claims this is implemented, but no deprovision code exists in the file. Add to the cron job.

---

## HIGH PRIORITY — Stripe Connect for Tenants

### 8. Stripe Connect Onboarding
- [x] Connect Express account creation wired up (lazy, on first dashboard visit) — `backend/src/routes/connect.ts:80-92`
- [~] **"Block live payments until `charges_enabled = true`"** — currently the checkout falls back to routing the funds to the platform account when Connect isn't ready (`backend/src/routes/checkout.ts:401-403`). Decide: actually block (return 4xx until merchant onboards) vs. continue routing-to-platform. Today is **not blocking**, just re-routing.
- [x] `account.updated` webhook updates `charges_enabled` / `payouts_enabled` — `webhooks.ts:268-293`
- [x] `stripe_account_id`, `charges_enabled`, `payouts_enabled` stored — migrations `0003`, `0009` + `db.ts:305-350`
- [x] Dashboard banner for incomplete Connect setup — `admin-dashboard/public/app.js:416` (`ConnectBanner`)
- [x] Connect restriction handling on `account.updated`

---

## HIGH PRIORITY — Content Moderation & Safety

### 9. AI + Programmatic Content Moderation
- [ ] Product creation: run name + description through Claude (`claude-haiku-4-5`) + OpenAI Moderation
- [ ] Store creation: scan store name, description, initial products
- [ ] Image moderation via Google Vision SafeSearch or AWS Rekognition before R2 publish
- [ ] Programmatic blocklist (banned keywords, illegal categories, OFAC countries)
- [ ] `moderation_log` table: `entity_type`, `entity_id`, `result`, `reason`, `reviewed_at`
- [ ] Auto-suspend tenant if >3 flagged products in 7 days
- [ ] Manual review queue UI in admin dashboard

### 10. Store Trust & Fraud Signals
- [ ] Rate-limit `POST /provision` (3 signups per IP per hour) — currently no limiter on the endpoint
- [ ] Detect disposable email domains at signup (Kickbox / Debounce / blocklist)
- [ ] Flag stores that upload many products within minutes of launch
- [ ] Log `signup_ip`, `user_agent`, country at provisioning time

---

## HIGH PRIORITY — Email & SMS Infrastructure

### 11. Transactional Email
- [x] **Resend integration in place** (`provisioning-service/src/email.ts:1`, `otp.ts:1`)
- [x] OTP delivery (signup verification)
- [x] Trial-ending reminders (30d/7d/1d/expired)
- [x] Payment failed
- [x] Store suspended
- [x] Payment recovered
- [ ] Welcome / store ready (after provisioning succeeds)
- [ ] Store deprovisioned warning (paired with Item 7's hard-delete)
- [ ] Order confirmation to merchant
- [ ] Order placed to end customer
- [ ] Set up SPF, DKIM, DMARC on `upcart.online` and any sending sub-domains

### 12. SMS / Phone Verification
- [x] **Twilio integration in place** for SMS OTP (`provision.ts:278-291`)
- [x] E.164 normalization in signup
- [x] Send / verify / expiry flow
- [x] `phone_number` and `phone_verified_at` columns

---

## MEDIUM PRIORITY — Templating & Storefront

### 13. Templating Engine
- [ ] **Status:** none. `backend/build.mjs` inlines static HTML files into a Worker asset map; no template engine.
- [x] **Partially obsoleted by the Store Editor:** the React editor at `/store-editor/` saves a `page_sections` JSON schema and the storefront's `store-renderer.js` renders it dynamically. For dynamic page content this replaces what the templating engine would have done.
- [ ] If we still want server-side templating for SEO / SSR (faster first paint, better crawler indexing), pick `eta` or template literals + a build step. Templates loadable from R2 so they update without redeploying every tenant Worker.

### 14. Base Store Template (Clean Slate)
- [ ] No `theme-base.css` exists yet — `customer-store/themes/` only contains `mono`, `minimal`, `boutique`, `bold`, `studio`. The "base" preset selectable in the editor falls back to system defaults inside `store-renderer.js`, not a real theme file.
- [ ] Build a true `base` theme that is **not** derived from any third-party design (Blackstar, etc.)
- [ ] Make `base` the default in the signup wizard and the seed schema (`provisioning-service/src/defaults/store-schema.ts:16` already uses `preset: 'base'`)
- [ ] Audit existing theme CSS for any third-party IP before launch

---

## MEDIUM PRIORITY — Custom Domains

### 15. Tenant Custom Domain Flow
- [ ] Dashboard UI for entering a custom domain (none exists today — `grep custom.*domain admin-dashboard/public/app.js` returns 0 hits)
- [ ] DNS instructions panel: "Point a CNAME to `shops.upcart.online`"
- [ ] Provisioning service calls Cloudflare **Custom Hostnames API**
- [ ] Poll `ssl_status` and `status` until both `active`
- [ ] Live status indicator: Pending DNS → SSL Issuing → Active
- [ ] Persist `custom_domain`, `custom_domain_verified_at`, `cf_custom_domain_id` (none of these columns exist on the tenants table yet)
- [ ] Worker routing: match incoming `Host` header against `custom_domain` (the `provision.ts:162` comment claims this is "partially wired" but no implementation found)
- [ ] Domain-ownership verification before activation (prevents domain hijacking)

---

## MEDIUM PRIORITY — Storefront Gaps

### 16. Order Confirmation Page
- [ ] `customer-store/success.html` is still a placeholder — only displays `Order ref: <session_id>` (lines 186-216)
- [ ] Fetch the order from the tenant Worker by Stripe session ID and render: line items, totals, shipping address, estimated delivery, contact email

### 17. Checkout Hardening
- [x] Out-of-stock guard at checkout — `backend/src/routes/checkout.ts:172-180` re-checks inventory before creating Payment Intent
- [x] "Sold Out" badge on product cards — `customer-store/products.html:138-141, 293-296`
- [x] Product image gallery (multi-image with thumbnails) — `customer-store/product.html:98-117`
- [x] Discount code UX (inline validation feedback) — `customer-store/cart.html:247-299`

### 18. Apple Pay / Google Pay
- [ ] Serve `/.well-known/apple-developer-merchantid-domain-association` from every tenant Worker (referenced in `customer-store/cart.html:596` and `customer-store/TODO.md:21` but never actually served)
- [ ] Register every tenant domain (subdomains + custom) with Stripe for Apple Pay
- [ ] Test Payment Request Button end-to-end

---

## MEDIUM PRIORITY — Infrastructure

### 19. Shared Webhook Router
- See [P1 H](#h-two-webhook-architectures--neither-fully-implemented) — needs an architectural decision before coding.

### 20. Configuration & Environments
- [ ] Separate `wrangler.toml` configs for `staging` vs `production`
- [ ] Staging uses separate D1 / R2 / Stripe test keys
- [ ] All sensitive values via Cloudflare Secrets (no plaintext in `wrangler.toml`)

---

## LOWER PRIORITY — Quality & Reliability

### 21. Automated Testing
- [ ] **No tests exist anywhere in the repo.** No `vitest.config`, `jest.config`, `*.test.ts`, or `*.spec.ts` files. Every service is manually verified.
- [ ] Unit tests: provisioning orchestration (mock Cloudflare API), discount edge cases, moderation pipeline
- [ ] Integration tests: checkout → webhook → order lifecycle

### 22. CI / CD Pipeline
- [ ] No `.github/` directory exists. No CI runs `tsc --noEmit` or `wrangler deploy --dry-run` on PRs.
- [ ] Lint + type-check + (eventually) test on every PR
- [ ] Auto-deploy to staging on merge to `main`
- [ ] Manual approval gate for production
- [ ] Automate `wrangler r2 object put` for the backend bundle (P2 K below)

### 23. Admin Dashboard Refactor
- [x] Removed `ThemeView` (350+ lines), `invertFor()`, `editor.html/js/css` — 2026-05-01
- [x] **Removed legacy `CustomizeView` (~410 LOC) + orphan CSS (~135 LOC); collapsed Customize + Templates into a single `/store-editor/` route — 2026-05-03**
- [ ] Continue splitting `admin-dashboard/public/app.js` (still ~3k lines) into per-view modules
- [ ] Moderation review panel (depends on Item 9)
- [ ] Subscription / billing status view
- [ ] Tenant health monitoring (Worker errors, D1 query failures)

### 24. Rate Limiting & Abuse Prevention
- [x] OTP send limiter (4 per identifier / 10 min) — `provision.ts:259-266`
- [ ] Rate-limit `POST /provision` overall (3/IP/hour)
- [ ] Rate-limit checkout attempts (10 per session per hour)

### 25. Observability
- [ ] Cloudflare Workers Analytics or Sentry for error tracking
- [ ] Alert on provisioning failures
- [ ] Ops dashboard: active tenants, suspended tenants, daily signups, revenue

---

## P2 — Quality / reliability (medium term)

### J. Theme selection not propagated from signup → storefront
- [ ] Blocked by P0-D. Once `theme` is seeded into `store_settings`, drop `window.STORE_THEME` from `customer-store/config.js` and have `theme.js` read theme from `GET /settings/public` at page load.
- [ ] Side benefit: theme becomes editable from the dashboard without redeploying the Worker.

### K. Automate backend bundle upload in CI/CD
- [ ] GitHub Actions: on push to `main`, `cd backend && npm run build && wrangler r2 object put upcart-worker-bundles/store-worker.js --file dist/index.js`
- [ ] `BUNDLE_VERSION` env var on provisioning service to pick which bundle version to deploy (rollbacks)

### L. Race: store marked active before DNS propagates
- [x] **Done.** `/health` probe via workers.dev URL added at `provision.ts:975-983` before flipping to `active`.

### M. `CF_WORKERS_SUBDOMAIN` hardcoded in committed `wrangler.toml`
- [ ] `provisioning-service/wrangler.toml:57` — `CF_WORKERS_SUBDOMAIN = "kevlongalloway1999m"` is checked in. Move to `wrangler secret put` or an untracked `.dev.vars`.
- [ ] Fail fast on startup if the var is missing.

### N. Test images committed to `customer-store/`
- [ ] Delete `customer-store/IMG_1304.jpeg`, `IMG_1305.jpeg`, `IMG_1306.jpeg`, `IMG_1309.png`
- [ ] Add `customer-store/*.jpeg` and `customer-store/*.png` to `.gitignore`

### O. `EASYPOST_API_KEY` never propagated to tenant workers
- [ ] In `runProvisioning()`, after `setWorkerSecret(JWT_SECRET)`, conditionally `setWorkerSecret(workerName, "EASYPOST_API_KEY", env.EASYPOST_API_KEY)` if set
- [ ] Until fixed: `POST /admin/orders/:id/label` returns 503 on every tenant regardless of plan.

---

## Newly discovered (this audit)

### P. Customize view persistence is now end-to-end (verified working)
- [x] Editor saves `page_sections` JSON to `/admin/settings`; storefront reads same key from `/settings/public` and renders via `store-renderer.js`. Verified after collapsing the duplicate legacy CustomizeView (2026-05-03).
- [x] Cache-Control: no-store on `/settings/public` so saves are visible immediately.
- [x] **Editor-rendered header / footer now apply to every storefront page (2026-05-03).** `store-renderer.js` recognises `#uc-storefront-header` / `#uc-storefront-footer` slot divs; `products.html`, `product.html`, `cart.html`, and `success.html` were updated to host those slots instead of hardcoded `<nav>` / `<footer>` blocks. A merchant editing the Header section's nav links / store name or the Footer's copyright in the dashboard now updates **all** customer-facing pages, not just the home page.

### Q. `success.html` cart-clear logic is duplicated in two places
- [ ] `customer-store/index.html:317-332` clears the cart on `?payment=success`. `customer-store/success.html` is the actual Stripe redirect target. The redundant clear in `index.html` is dead code now.

### R. `ConnectBanner` mounts on every authenticated page-load
- [ ] `admin-dashboard/public/app.js:451` — calls `/connect/status` on every route change. Should cache for the session (it rarely changes mid-session).

---

## NOTES

- **Provisioning order (final):** Collect card → $1 auth → email/phone OTP → provision (D1, R2, Worker, DNS) → `/health` probe → refund $1 → create Stripe Subscription (trial) → send welcome email *(welcome email still TODO under Item 11).*
- **Unblock-revenue path:** P0-A (per-tenant webhook), P0-C (`STRIPE_PRICE_ID`) and P0-D (seed `store_settings`). Three small PRs reopen the entire revenue + trial + storefront-theme pipeline.
- **Stripe Connect:** decide whether to keep lazy account creation (current) or move to provisioning (P1-G). Either is defensible; pick one and remove the comment ambiguity.

---

## SESSION UPDATES

### 2026-05-03 — Editor chrome now renders on every storefront page
**Branch:** `claude/storefront-edit-functionality-KkVPm`

- **Gap closed:** the editor's saved schema (`page_sections`) drove only `index.html`. Other pages (`products.html`, `product.html`, `cart.html`, `success.html`) shipped with hardcoded `<nav>` and `<footer>` blocks, so a merchant who edited their nav links or footer copyright in the dashboard saw the change on the home page but not anywhere else — the most jarring "I edited it but it didn't apply" failure mode left in the editor pipeline.
- **Fix:** `store-renderer.js` now recognises two new slot ids — `#uc-storefront-header` and `#uc-storefront-footer` — in addition to the existing full-canvas `#uc-editor-canvas`. When a page hosts the slots, the renderer drops the chrome-typed sections (`announcement-bar`, `header`/`nav`, `footer`) into them and leaves the page body untouched. Each non-home page replaced its static `<nav>` / `<footer>` with the slot divs and now loads `store-renderer.js`.
- **Defense in depth:** the renderer's full-body theme rule (`body { background: var(--uc-bg); … }`) is now gated on `#uc-editor-canvas` existing, so subpages keep their own static body styling and don't double-apply theme variables.
- **Verified:** `grep '<nav>\\|<footer>' customer-store/*.html` returns zero matches outside `index.html`.

### 2026-05-03 — Store-editor consolidation
**Branch:** `claude/fix-store-customization-0DQf8`

- **Root cause of "saved changes don't appear on storefront":** the navbar's "Customize" tab pointed at a legacy `CustomizeView` in `admin-dashboard/public/app.js` that wrote flat keys (`theme`, `brand_primary`, `hero_title`, …). The storefront's `store-renderer.js` reads only `page_sections` JSON. So every "Save & Publish" persisted data nothing renders.
- **Fix:** deleted `CustomizeView` (~410 LOC) + orphan CSS (~135 LOC), routed `/customize`, `/theme`, `/settings` to `/store-editor/`, collapsed two navbar entries ("Customize" + "Templates") into one ("Customize" → `/store-editor/`).
- **Defense in depth:** added `Cache-Control: no-store` on `GET /settings/public` so saves are visible on the next storefront load instead of waiting out a heuristic browser cache.
- **Verified end-to-end:** editor saves → backend `store_settings.page_sections` row updates → storefront `fetch('/settings/public')` returns it → `store-renderer.js` renders it into `#uc-editor-canvas`.

### 2026-05-01 — Dashboard tab consolidation & dead code removal
**Branch:** `claude/fix-edit-consolidate-tabs-A4dAx`

- Deleted `admin-dashboard/public/editor.html`, `editor.js`, `editor.css` (superseded by React store editor)
- Deleted `ThemeView` (350+ lines) and `invertFor()` helper from `app.js`
- Renamed nav "Store Editor" → "Templates" *(superseded by 2026-05-03 consolidation above)*

### 2026-04-28 — P0/P1/P2 audit baseline
**Branch:** `claude/fix-deploy-stripe-setup-myYtq`

- Original audit landing this file at 42/100 readiness; identified the four P0 blockers (A–D) that are still open today.
