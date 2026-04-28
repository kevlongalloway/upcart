# Upcart — Production Readiness TODO

> Last updated: 2026-04-28  
> **Audit completed on branch `claude/fix-deploy-stripe-setup-myYtq` — overall readiness: 42/100.**  
> Core provisioning flow (D1, R2, Worker, DNS, auth) works. Three independent P0 blockers  
> prevent any real merchant from receiving revenue or seeing orders in their dashboard.  
> See [Audit Findings](#audit-findings--added-2026-04-28) section at bottom for full details.

---

## CRITICAL — Must ship before open beta

### 1. Pre-Provisioning Payment Verification ($1 Auth Charge)
- [x] Add a Stripe Payment Intent step (`amount: 100, capture_method: manual`) to the signup wizard **before** any cloud resources are provisioned
- [x] Only proceed to provision (Worker, D1, R2, DNS) after the $1 authorization succeeds
- [x] Capture and immediately refund the $1 hold once provisioning completes successfully
- [x] If the card declines, show a clear error and do not spin up any resources
- [x] Store the `payment_method_id` on the tenant record for future subscription charges
- [x] Gate: no provisioning without a valid payment method on file

### 2. Identity Verification Before Provisioning
- [x] Require **at least one** of the following before spinning up Workers, D1, or R2:
  - **Email verification** — send OTP/magic link; block provisioning until clicked
  - **Phone (SMS) verification** — send 6-digit OTP via Twilio/Resend; block until confirmed
- [x] Store `email_verified_at` and/or `phone_verified_at` on the tenant record
- [x] Show clear UI states: "Check your inbox" / "Enter the code we texted you"
- [x] Resend flow with rate limiting (max 3 resends per 10 min)
- [x] OTPs expire after 10 minutes

### 3. Untrusted Store / SSL Certificate Issues
- [ ] **Root cause:** Browsers flag sites as untrusted when the SSL certificate is missing, self-signed, or not yet propagated
- [ ] Ensure Cloudflare issues an SSL certificate for every tenant subdomain (`*.upcart.online`) immediately at provisioning — use Cloudflare's Universal SSL or ACM wildcard cert
- [ ] For custom domains: automate Cloudflare SSL issuance when a custom hostname is added via the API (`ssl: { method: "http", type: "dv", settings: { ... } }`)
- [ ] Confirm `ssl_status` = `active` before marking tenant as live; poll and retry if pending
- [ ] Add CAA DNS records on `upcart.online` to pin certificate authority
- [ ] Apple Pay / Google Pay require domain verification file at `/.well-known/apple-developer-merchantid-domain-association` — serve this from every tenant Worker

---

## HIGH PRIORITY — Subscription & Billing

### 4. Tenant Subscription Plans
- [x] Define plan tiers (e.g., Free Trial → Starter → Pro) in `provisioning-service/migrations`
- [x] Create `subscriptions` table: `tenant_id`, `plan`, `status`, `trial_ends_at`, `current_period_end`, `stripe_subscription_id`, `stripe_customer_id`
- [x] Use Stripe Subscriptions API to create a subscription after the $1 auth charge
- [x] Attach the saved `payment_method_id` as the default payment method for the Stripe Customer

### 5. Free Trial (3 Months)
- [x] Grant every new tenant a 3-month free trial automatically at signup
- [x] Set `trial_ends_at = now() + 90 days` on the tenant record
- [x] During trial: all features fully available, no charge
- [x] After trial: first real charge via Stripe Subscription billing cycle

### 6. Trial Expiry Notices
- [x] Send email at **30 days before** trial ends: "Your free trial ends in 30 days — add a card to keep your store live"
- [x] Send email at **7 days before**: urgency notice
- [x] Send email at **1 day before**: final warning
- [x] On trial expiration day: send "Your trial has ended" email with upgrade CTA
- [x] Schedule via a Cloudflare Cron Trigger on the provisioning service (daily job queries `trial_ends_at`)

### 7. Unpaid / Delinquent Tenant Handling
- [x] On Stripe `invoice.payment_failed` webhook: mark tenant `status = payment_failed`, send failure email
- [x] After **3 failed attempts** (Stripe's default retry schedule): set tenant `status = suspended`
- [x] Suspended tenants: Worker returns a 402 "Store Suspended" page (not a crash)
- [x] Grace period: 7 days from first failure before suspension
- [x] On successful payment recovery: set `status = active`, restore Worker immediately
- [ ] Hard delete / deprovision after 30 days of non-payment (with data export warning email)

---

## HIGH PRIORITY — Stripe Connect for Tenants

### 8. Stripe Connect Onboarding
- [x] After provisioning, prompt tenant to complete Stripe Connect Express onboarding (currently partially wired but not enforced)
- [x] Block live payments (non-test) until Connect onboarding is `charges_enabled = true`
- [x] Poll or use `account.updated` webhook to detect when onboarding completes
- [x] Store `stripe_account_id`, `charges_enabled`, `payouts_enabled` on tenant record
- [x] Show a dashboard banner: "Complete your payout setup to accept live payments"
- [x] Handle Connect account restrictions (e.g., info needed, capabilities disabled)

---

## HIGH PRIORITY — Content Moderation & Safety

### 9. AI + Programmatic Content Moderation
- [ ] **At product creation:** run product name + description through a moderation pipeline before saving
  - Use Claude API (`claude-haiku-4-5`) for semantic classification: illegal goods, weapons, CSAM, counterfeit, drugs, etc.
  - Use OpenAI Moderation API as a second pass (free tier available)
  - Flag or auto-reject products that trip either classifier
- [ ] **At store creation:** scan store name, description, and initial products
- [ ] **Image moderation:** run R2-uploaded product images through Google Vision SafeSearch or AWS Rekognition before making them public
- [ ] **Programmatic rules:** maintain a blocklist of banned keywords, known illegal product categories, and OFAC-sanctioned countries
- [ ] Store moderation decisions in a `moderation_log` table: `entity_type`, `entity_id`, `result`, `reason`, `reviewed_at`
- [ ] **Escalation:** auto-suspend tenant if >3 flagged products within 7 days; alert internal ops team
- [ ] **Manual review queue:** admin UI panel showing flagged content for human review

### 10. Store Trust & Fraud Signals
- [ ] Rate-limit `/provision` endpoint (max 3 signups per IP per hour) to prevent abuse
- [ ] Detect disposable email domains at signup (block known throwaway providers)
- [ ] Flag newly provisioned stores that upload many products within minutes of launch
- [ ] Log `signup_ip`, `user_agent`, and country at provisioning time for forensics

---

## HIGH PRIORITY — Email & SMS Infrastructure

### 11. Transactional Email
- [ ] Integrate Resend or SendGrid for transactional email
- [ ] Templates needed:
  - Email verification OTP
  - Welcome / store ready
  - Trial ending (30d, 7d, 1d)
  - Trial expired
  - Payment failed
  - Payment recovered
  - Store suspended
  - Store deprovisioned warning
  - Order confirmation (to merchant)
  - Order placed (to end customer)
- [ ] Set up SPF, DKIM, DMARC on `upcart.online` and all sending domains

### 12. SMS / Phone Verification
- [ ] Integrate Twilio Verify or Resend phone OTP
- [ ] Phone number input + E.164 normalization in signup form
- [ ] OTP send, verify, and expiry flow
- [ ] Store `phone_number` and `phone_verified_at` on tenant

---

## MEDIUM PRIORITY — Templating & Storefront

### 13. Templating Engine
- [ ] Replace the current static HTML embed approach with a proper server-side templating layer
- [ ] Recommended: use `eta` (lightweight, Deno/Workers-compatible) or plain template literals with a compile step
- [ ] Templates should be fetched from R2 at Worker boot so they can be updated without re-deploying every tenant Worker
- [ ] Support per-tenant variable injection: store name, colors, logo URL, Stripe publishable key, etc.

### 14. Base Store Template (Clean Slate)
- [ ] Create a new `base` theme that is **not** derived from Blackstar or any existing design
- [ ] Requirements:
  - Minimal, neutral, mobile-first
  - Fast: no external fonts, no heavy CSS frameworks, vanilla CSS variables
  - Accessible: AA contrast, keyboard navigation, ARIA labels
  - Sections: header (logo + nav), hero/banner, product grid, product detail, cart drawer, checkout, order confirmation
  - Customizable via CSS variables injected from tenant branding settings
- [ ] Remove or quarantine the legacy Blackstar theme to avoid IP issues
- [ ] Make `base` the default for all new tenant signups

---

## MEDIUM PRIORITY — Custom Domains

### 15. Tenant Custom Domain Flow
- [ ] Tenant enters their domain in the dashboard (e.g., `shop.mybrand.com`)
- [ ] Dashboard shows DNS instructions: "Point a CNAME to `shops.upcart.online`"
- [ ] Provisioning service calls Cloudflare Custom Hostnames API to register the domain
- [ ] Poll `ssl_status` and `status` until both are `active` (can take up to 24h for SSL)
- [ ] Show tenant a live status indicator: Pending DNS → SSL Issuing → Active
- [ ] Update tenant record with `custom_domain`, `custom_domain_verified_at`, `cf_custom_domain_id`
- [ ] Worker routing: if `Host` header matches `custom_domain`, serve tenant store (already partially wired)
- [ ] Validate domain ownership before activating to prevent domain hijacking

---

## MEDIUM PRIORITY — Storefront Gaps

### 16. Order Confirmation Page
- [ ] `success.html` is currently a placeholder — render real order data (order number, items, totals)
- [ ] Fetch order from Worker API using session ID from Stripe redirect
- [ ] Show estimated delivery, shipping address, contact email

### 17. Checkout Hardening
- [ ] Out-of-stock guard at checkout time (re-check inventory before creating Payment Intent)
- [ ] "Sold Out" badge on product cards and detail pages
- [ ] Product image gallery (multi-image with thumbnails)
- [ ] Discount code UX improvements (inline validation feedback)

### 18. Apple Pay / Google Pay
- [ ] Serve `/.well-known/apple-developer-merchantid-domain-association` from every tenant Worker
- [ ] Register all tenant domains (subdomains + custom) with Stripe for Apple Pay
- [ ] Test Payment Request Button flow end-to-end

---

## MEDIUM PRIORITY — Infrastructure

### 19. Shared Webhook Router
- [ ] Implement a single `POST /webhooks/stripe` on the provisioning service (or a dedicated Worker)
- [ ] Route events to the correct tenant based on `account` field (for Connect events) or metadata
- [ ] Handle: `invoice.payment_failed`, `invoice.paid`, `account.updated`, `customer.subscription.*`

### 20. Configuration & Environments
- [ ] Separate `wrangler.toml` configs for `staging` and `production`
- [ ] Staging should use separate D1 databases, R2 buckets, and Stripe test keys
- [ ] Use Cloudflare Secrets for all sensitive values (no plaintext in wrangler.toml)

---

## LOWER PRIORITY — Quality & Reliability

### 21. Automated Testing
- [ ] Unit tests for provisioning orchestration (mock Cloudflare API)
- [ ] Integration tests for the checkout → webhook → order lifecycle
- [ ] Tests for discount code edge cases (expiry, max uses, stacking)
- [ ] Tests for moderation pipeline

### 22. CI / CD Pipeline
- [ ] GitHub Actions: lint, type-check, test on every PR
- [ ] Automated deploy to staging on merge to `main`
- [ ] Manual approval gate for production deploys

### 23. Admin Dashboard Refactor
- [ ] Split `admin-dashboard/public/app.js` (currently 3100+ lines) into view modules
- [ ] Add moderation review panel
- [ ] Add subscription/billing status view
- [ ] Add tenant health monitoring (Worker errors, D1 query failures)

### 24. Rate Limiting & Abuse Prevention
- [ ] Rate-limit `/provision` (3 requests/IP/hour via Cloudflare WAF rule or Workers KV)
- [ ] Rate-limit OTP sends (3 per phone/email per 10 min)
- [ ] Rate-limit checkout attempts (10 per session per hour)

### 25. Observability
- [ ] Integrate Cloudflare Workers Analytics or Sentry for error tracking
- [ ] Alert on provisioning failures
- [ ] Dashboard for ops: active tenants, suspended tenants, daily signups, revenue

---

## NOTES

- **Provisioning order (final):** Collect card → $1 auth charge → Verify email/phone OTP → Provision (D1, R2, Worker, DNS) → Refund $1 → Create Stripe Subscription (trial) → Send welcome email
- **Untrusted store fix:** Cloudflare Universal SSL covers `*.upcart.online` automatically; for custom domains, the Custom Hostnames API triggers DV cert issuance — confirm `ssl_status = active` before going live
- **Blackstar:** Audit current themes for any third-party IP before launch; replace with the new `base` template as the default
- **Stripe Connect:** Do not allow live transactions until `charges_enabled = true` on the tenant's Connect account

---

## AUDIT FINDINGS — Added 2026-04-28

> Branch audited: `claude/fix-deploy-stripe-setup-myYtq`  
> Overall score: **42 / 100** — provisioning plumbing works, but three independent blockers prevent revenue + order flow from functioning.

### P0 — Breaks every live merchant (ship immediately)

#### A. Per-tenant Stripe webhook endpoint never registered
- [ ] In `runProvisioning()` (after Worker deploy), call Stripe `POST /webhook_endpoints` with `url: https://${hostname}/webhooks/stripe` and events `["checkout.session.completed", "payment_intent.succeeded", "payment_intent.payment_failed"]`
- [ ] Store `webhook_endpoint.id` on the tenant record for deprovisioning cleanup
- [ ] Set the returned per-tenant webhook signing secret on the worker via `cf.setWorkerSecret(workerName, "STRIPE_WEBHOOK_SECRET", perTenantSecret)` (overrides the shared platform secret set earlier in the same flow)
- [ ] **Without this fix:** customer purchases succeed (money collected) but `checkout.session.completed` is never delivered to the tenant worker → orders never created in D1 → merchant sees zero orders in dashboard forever

#### B. R2 bucket public access not automated — product images 403 for every new store
- [ ] **Short-term (manual script):** after provisioning, run `wrangler r2 bucket update <name> --public` or enable via Cloudflare dashboard; document this as a required deployment step
- [ ] **Preferred long-term:** add a Worker route `/images/:key` on the tenant worker that streams from the private `IMAGES` R2 binding via `c.env.IMAGES.get(key)` — eliminate public buckets entirely, use signed or same-origin access
- [ ] Update `R2_PUBLIC_URL` var to point to the Worker's `/images/` route instead of the `.r2.dev` public URL
- [ ] Until fixed: every tenant's product images return HTTP 403; storefront renders with broken image placeholders

#### C. `STRIPE_PRICE_ID` is empty — subscription / trial never created for any tenant
- [ ] Set `STRIPE_PRICE_ID` in `provisioning-service/wrangler.toml` to a real recurring Stripe Price ID
- [ ] Create the price in Stripe dashboard → Products → Add product → Add price (recurring, monthly, amount = plan cost, trial_period_days = 0 since we set trial_end at subscription creation)
- [ ] Verify subscription creation step runs end-to-end after setting the price ID
- [ ] Until fixed: no tenant gets a trial period or subscription; billing infrastructure is present but never activated; trial expiry cron has nothing to act on

#### D. `store_settings` table is never seeded at provisioning
- [ ] After `cf.runD1Migrations()`, insert initial `store_settings` rows via `cf.runD1Query()`:
  - `key="store_name"` → `input.store.name`
  - `key="theme"` → `input.store.theme`
  - `key="country"` → `input.store.country`
  - `key="currency"` → `input.store.currency`
- [ ] Without this: theme selected at signup has no effect (all stores get hardcoded default), Connect onboarding form doesn't pre-fill store name/country, `GET /settings/public` returns empty

### P1 — Security / correctness (ship before public beta)

#### E. `ADMIN_PASSWORD_HASH` passed as `plain_text` var — visible in Cloudflare dashboard
- [ ] Remove `ADMIN_PASSWORD_HASH` from the `vars` object in `provision.ts` (around line 267)
- [ ] Add `await cf.setWorkerSecret(workerName, "ADMIN_PASSWORD_HASH", adminPasswordHash)` alongside `JWT_SECRET` and the Stripe secrets
- [ ] Anyone with Cloudflare dashboard access can currently read the PBKDF2 hash and mount an offline attack

#### F. `/debug` route publicly accessible on every tenant worker
- [ ] `backend/src/index.ts`: move `app.route("/debug", debug)` to below the `adminAuthMiddleware()` block, or remove entirely for production builds
- [ ] Currently exposes `ADMIN_USERNAME` (full, unmasked), Stripe publishable key hint, D1 row counts, R2 binding status to any anonymous HTTP request

#### G. Stripe Connect account not created at provisioning — all revenue goes to platform
- [ ] Add a step in `runProvisioning()` (after Worker secrets are set) to call `stripe.accounts.create({ type: "express", country, capabilities: { card_payments: { requested: true }, transfers: { requested: true } } })`
- [ ] Store `acct.id` in `store_settings` (key=`stripe_connect_account_id`) via D1 query on the new tenant DB
- [ ] Store `acct.id` on the provisioning tenant record via `tenantDB.updateConnectStatus()`
- [ ] The merchant still needs to complete Express onboarding; send them the Account Link URL in the welcome email
- [ ] Until fixed: checkout sessions run without `transfer_data.destination`; customer payments go to platform Stripe account; merchants receive zero payouts

#### H. Two Stripe webhook endpoints — architecture conflict
- [ ] Decide on one of two approaches and document it:
  - **Option A (recommended):** Register per-tenant webhook endpoints (covered by item A above). Each tenant's `/webhooks/stripe` receives checkout events directly. Platform provisioning service `/webhooks/stripe` receives only subscription/Connect events.
  - **Option B:** Route all events through the platform webhook. Add a checkout-event router to `provisioning-service/src/routes/webhooks.ts` that reads `metadata.tenant_id` from checkout events and POSTs to the correct `store_url/webhooks/stripe` (internal forwarding).
- [ ] Neither approach is currently implemented; checkout events are silently dropped

#### I. `STORE_MIGRATIONS` in `provision.ts` is disconnected from `backend/migrations/*.sql`
- [ ] Add a CI step or pre-deploy script that diffs `STORE_MIGRATIONS` constant against the concatenated content of all `backend/migrations/*.sql` files and fails if they diverge
- [ ] Alternatively, generate `STORE_MIGRATIONS` at build time by reading the migration files, so it can never drift

### P2 — Quality / reliability (medium term)

#### J. Theme selection not propagated from signup to storefront
- [ ] `backend/build.mjs` overrides `config.js` with only `window.BST_API_BASE=""` — `window.STORE_THEME` is not set
- [ ] Fix: after seeding `store_settings.theme` (item D above), have `theme.js` read the theme from `GET /settings/public` at page load rather than from `window.STORE_THEME`
- [ ] This also makes the theme changeable from the dashboard without redeploying the worker

#### K. Automate backend bundle upload in CI/CD
- [ ] GitHub Actions: on push to `main` (or on new tag), run `cd backend && npm run build`, then `wrangler r2 object put upcart-worker-bundles/store-worker.js --file dist/index.js`
- [ ] Add a `BUNDLE_VERSION` env var to provisioning service to select which bundle version to deploy (allows rollbacks)

#### L. Race condition: store marked active before DNS propagates
- [ ] After domain binding, add a brief poll (up to 60s, 5s intervals) probing `https://${hostname}/health` via the workers.dev URL before marking tenant active
- [ ] If health check fails after timeout, leave status as `configuring_domain` — client continues polling; mark active once `/health` returns 200

#### M. `CF_WORKERS_SUBDOMAIN` hardcoded in wrangler.toml
- [ ] `provisioning-service/wrangler.toml`: move `CF_WORKERS_SUBDOMAIN = "kevlongalloway1999m"` out of `[vars]` (committed) into a secret or a separate `.env` file that is `.gitignore`d
- [ ] Add a validation on startup: `if (!env.CF_WORKERS_SUBDOMAIN) throw new Error("CF_WORKERS_SUBDOMAIN must be set")`

#### N. Remove test images committed to customer-store/
- [ ] Delete `customer-store/IMG_1304.jpeg`, `IMG_1305.jpeg`, `IMG_1306.jpeg`, `IMG_1309.png` from the repo
- [ ] Add `*.jpeg` / `*.png` (or `customer-store/*.jpeg`) to `.gitignore`

#### O. `EASYPOST_API_KEY` never propagated to tenant workers
- [ ] Add `EASYPOST_API_KEY` to provisioning-service secrets (optional, skip if empty)
- [ ] In `runProvisioning()`, if `env.EASYPOST_API_KEY`, call `cf.setWorkerSecret(workerName, "EASYPOST_API_KEY", env.EASYPOST_API_KEY)`
- [ ] Until fixed: `POST /admin/orders/:id/label` on every tenant worker returns a 503 regardless of plan
