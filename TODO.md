# Upcart — Production Readiness TODO

> Last updated: 2026-04-26  
> Provisioning is working. This file tracks everything needed before public launch.

---

## CRITICAL — Must ship before open beta

### 1. Pre-Provisioning Payment Verification ($1 Auth Charge)
- [ ] Add a Stripe Payment Intent step (`amount: 100, capture_method: manual`) to the signup wizard **before** any cloud resources are provisioned
- [ ] Only proceed to provision (Worker, D1, R2, DNS) after the $1 authorization succeeds
- [ ] Capture and immediately refund the $1 hold once provisioning completes successfully
- [ ] If the card declines, show a clear error and do not spin up any resources
- [ ] Store the `payment_method_id` on the tenant record for future subscription charges
- [ ] Gate: no provisioning without a valid payment method on file

### 2. Identity Verification Before Provisioning
- [ ] Require **at least one** of the following before spinning up Workers, D1, or R2:
  - **Email verification** — send OTP/magic link; block provisioning until clicked
  - **Phone (SMS) verification** — send 6-digit OTP via Twilio/Resend; block until confirmed
- [ ] Store `email_verified_at` and/or `phone_verified_at` on the tenant record
- [ ] Show clear UI states: "Check your inbox" / "Enter the code we texted you"
- [ ] Resend flow with rate limiting (max 3 resends per 10 min)
- [ ] OTPs expire after 10 minutes

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
- [ ] Define plan tiers (e.g., Free Trial → Starter → Pro) in `provisioning-service/migrations`
- [ ] Create `subscriptions` table: `tenant_id`, `plan`, `status`, `trial_ends_at`, `current_period_end`, `stripe_subscription_id`, `stripe_customer_id`
- [ ] Use Stripe Subscriptions API to create a subscription after the $1 auth charge
- [ ] Attach the saved `payment_method_id` as the default payment method for the Stripe Customer

### 5. Free Trial (3 Months)
- [ ] Grant every new tenant a 3-month free trial automatically at signup
- [ ] Set `trial_ends_at = now() + 90 days` on the tenant record
- [ ] During trial: all features fully available, no charge
- [ ] After trial: first real charge via Stripe Subscription billing cycle

### 6. Trial Expiry Notices
- [ ] Send email at **30 days before** trial ends: "Your free trial ends in 30 days — add a card to keep your store live"
- [ ] Send email at **7 days before**: urgency notice
- [ ] Send email at **1 day before**: final warning
- [ ] On trial expiration day: send "Your trial has ended" email with upgrade CTA
- [ ] Schedule via a Cloudflare Cron Trigger on the provisioning service (daily job queries `trial_ends_at`)

### 7. Unpaid / Delinquent Tenant Handling
- [ ] On Stripe `invoice.payment_failed` webhook: mark tenant `status = payment_failed`, send failure email
- [ ] After **3 failed attempts** (Stripe's default retry schedule): set tenant `status = suspended`
- [ ] Suspended tenants: Worker returns a 402 "Store Suspended" page (not a crash)
- [ ] Grace period: 7 days from first failure before suspension
- [ ] On successful payment recovery: set `status = active`, restore Worker immediately
- [ ] Hard delete / deprovision after 30 days of non-payment (with data export warning email)

---

## HIGH PRIORITY — Stripe Connect for Tenants

### 8. Stripe Connect Onboarding
- [ ] After provisioning, prompt tenant to complete Stripe Connect Express onboarding (currently partially wired but not enforced)
- [ ] Block live payments (non-test) until Connect onboarding is `charges_enabled = true`
- [ ] Poll or use `account.updated` webhook to detect when onboarding completes
- [ ] Store `stripe_account_id`, `charges_enabled`, `payouts_enabled` on tenant record
- [ ] Show a dashboard banner: "Complete your payout setup to accept live payments"
- [ ] Handle Connect account restrictions (e.g., info needed, capabilities disabled)

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
