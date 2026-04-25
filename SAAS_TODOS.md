# Upcart SaaS Platform — Implementation Status & Roadmap

## Overview

Upcart is a self-service e-commerce SaaS platform (Shopify model). Merchants sign up, create their own online store, list products, and sell directly to customers. Upcart handles all payment processing through its own Stripe account — merchants never touch Stripe keys. Revenue is earned via transaction fees deducted from each sale. Merchants accumulate a balance and can request payouts to their connected bank account.

**Tech Stack**: Hono.js on Cloudflare Workers, D1 (SQLite), R2 for images, Stripe for payments.

---

## Phase 1: Onboarding & Landing Page — COMPLETE

### Landing Page (`onboarding/index.html`)
- [x] Modern dark-theme landing page with hero, features, pricing, how-it-works, FAQ
- [x] Responsive design (mobile, tablet, desktop)
- [x] Embedded signup wizard (no separate page)

### Signup Flow (2-step, low friction — Shopify model)
- [x] **Step 1 — Account**: Email + Password (just 2 fields)
- [x] **Step 2 — Store Details**: First name, last name, store name (with live URL slug preview), business category dropdown
- [x] **Step 3 — Success**: Confirmation with store URL, redirect to dashboard
- [x] Client-side validation with inline error messages
- [x] Email availability check (`GET /auth/signup/check-email`)
- [x] Store URL slug auto-generated from business name (e.g., `my-store.upcart.online`)

### Key Design Decisions
- **No payout/bank info during signup** — low friction first, bank details added later in dashboard
- **No Stripe key setup for merchants** — Upcart processes all payments centrally
- **$0 starting balance** — balance grows as merchants make sales
- **Self-service model** — merchants build and manage their own stores

### Backend Signup Endpoint
- **File**: `backend/src/routes/merchantSignup.ts`
- **Route**: `POST /auth/signup`
- **Request**:
  ```json
  {
    "firstName": "string",
    "lastName": "string",
    "email": "string (unique)",
    "password": "string (min 8 chars)",
    "businessName": "string",
    "businessCategory": "string"
  }
  ```
- **Response** (201): JWT token, merchant_id, email, business_name, store_slug, balance (0)
- **Route**: `GET /auth/signup/check-email?email=...` — returns `{ available: true/false }`

---

## Phase 2: Merchant Authentication — COMPLETE

### Login Endpoint
- **File**: `backend/src/routes/merchantLogin.ts`
- **Route**: `POST /auth/login`
- [x] Email + password authentication against D1
- [x] SHA-256 password hashing with timing-safe comparison
- [x] Account suspension check (`active` flag)
- [x] JWT token issued (7-day TTL, `type: "merchant"` claim)
- [x] Returns token + merchant profile (id, email, names, business_name, store_slug, balance)

### Auth Middleware
- **File**: `backend/src/middleware/merchantAuth.ts`
- [x] Verifies JWT with `type: "merchant"` in payload
- [x] Sets `merchantId` and `merchantEmail` on request context
- [x] Protects all `/merchant/*` routes

### Profile Endpoint
- **File**: `backend/src/routes/merchantProfile.ts`
- **Route**: `GET /merchant/me`
- [x] Returns full merchant profile (name, email, business, store slug, balance, active status)
- [x] Includes default payout account details if connected

---

## Phase 3: Balance & Payout Management — COMPLETE

### Database Migration
- **File**: `backend/migrations/0004_create_merchants.sql`
- [x] `merchants` table (id, names, email, password_hash, business_name, category, store_slug, balance in cents, active flag)
- [x] `merchant_payouts` table (bank details — only stores last 4 digits of account/routing numbers)
- [x] `balance_transactions` table (amount in cents +/-, type: sale/payout/refund/fee/adjustment, status, reference)
- [x] `payout_requests` table (amount, status: pending/processing/completed/failed, timestamps)

### Balance Endpoints
- **File**: `backend/src/routes/merchantBalance.ts`
- **Route**: `GET /merchant/balance`
  - [x] Current balance
  - [x] Pending payout total
  - [x] Lifetime totals (sales, payouts, refunds, fees)
- **Route**: `GET /merchant/balance/transactions?type=sale&limit=20&offset=0`
  - [x] Paginated transaction history
  - [x] Optional filter by type (sale, payout, refund, fee)

### Payout Endpoints
- **File**: `backend/src/routes/merchantPayouts.ts`
- **Route**: `PUT /merchant/payouts/settings`
  - [x] Add or update bank account (bank name, account holder, account number, routing number)
  - [x] Only stores last 4 digits of account/routing numbers
  - [x] Upserts default payout account
- **Route**: `GET /merchant/payouts/settings`
  - [x] Returns connected payout account (masked details)
- **Route**: `POST /merchant/payouts`
  - [x] Request a payout (minimum $10.00 / 1000 cents)
  - [x] Validates sufficient balance
  - [x] Validates payout account is connected
  - [x] Prevents duplicate pending payouts
  - [x] Debits balance + creates transaction log entry
- **Route**: `GET /merchant/payouts?limit=20&offset=0`
  - [x] Lists payout request history (paginated)

### Route Registration
- **File**: `backend/src/index.ts`
- [x] All merchant routes registered under `/merchant/*` with auth middleware
- [x] Auth routes (`/auth/signup`, `/auth/login`) are public (no JWT required)

---

## Phase 4: Merchant Dashboard UI (TODO)
- [ ] Login page (email + password → store JWT → redirect to dashboard)
- [ ] Dashboard home with balance overview, recent transactions, quick actions
- [ ] Payout settings page (connect/update bank account)
- [ ] Request payout flow
- [ ] Transaction history view with filters
- [ ] Store settings page (edit business name, category, etc.)
- [ ] Product management (CRUD for store products)
- [ ] Order management (view orders, update status)

## Phase 5: Store & Product Management (TODO)
- [ ] Product CRUD scoped to merchant (create, edit, delete, list)
- [ ] Product image upload via R2
- [ ] Inventory tracking
- [ ] Category & collection management
- [ ] Store customization (theme, logo, description)
- [ ] Public storefront at `{slug}.upcart.online`

## Phase 6: Order & Checkout Flow (TODO)
- [ ] Customer-facing storefront with product browsing
- [ ] Cart + Stripe checkout integration per merchant store
- [ ] Webhook handler: on successful payment, credit merchant balance (minus fees)
- [ ] Order creation + tracking
- [ ] Email notifications (order confirmation, shipping updates)

## Phase 7: Platform Admin (TODO)
- [ ] Admin dashboard for platform-wide management
- [ ] Merchant account management (view, suspend, reactivate)
- [ ] Balance adjustments and dispute resolution
- [ ] Platform-wide analytics (GMV, active merchants, revenue)
- [ ] Payout approval workflow

## Phase 8: Advanced Features (TODO)
- [ ] Password reset flow (email-based)
- [ ] Email verification on signup
- [ ] Two-factor authentication
- [ ] Custom domain support for merchant stores
- [ ] Multi-currency support
- [ ] Subscription/recurring billing
- [ ] Discount/coupon system per merchant store
- [ ] Advanced analytics per merchant

---

## Transaction & Revenue Model

### How Money Flows
1. Customer pays through merchant's Upcart storefront
2. Stripe processes payment to Upcart's account
3. Upcart deducts platform fee (e.g., 2.9% + $0.30 per transaction)
4. Net amount credited to merchant's balance (`balance_transactions` with type `sale`)
5. Merchant requests payout when ready (minimum $10)
6. Payout processed to merchant's connected bank account

### Balance Rules
- All amounts stored in **cents** (integer) to avoid floating-point issues
- Balance starts at **$0** — no free credits
- Balance can only decrease via payouts or refunds
- Pending payouts are tracked separately from available balance
- Minimum payout: **$10.00** (1000 cents)
- One pending payout at a time per merchant

---

## Environment Variables
```
JWT_SECRET=your_jwt_secret_key
ADMIN_USERNAME=admin_email@example.com
ADMIN_PASSWORD=secure_password
CORS_ORIGINS=https://yourdomain.com,http://localhost:3000
DB_ADAPTER=d1
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Security Notes

- Passwords hashed with SHA-256 (upgrade to bcrypt/Argon2 before production)
- Bank account numbers are **never stored in full** — only last 4 digits
- JWT tokens expire after 7 days
- Merchant and admin tokens are distinguished by `type` claim
- Timing-safe password comparison to prevent timing attacks
- All input validated server-side with Zod schemas
- CORS, CSRF, and secure headers enabled globally

---

## Database Migrations
- `0001` — Products, orders, order items
- `0002` — Discounts
- `0003` — Shipping labels
- `0004` — Merchants, merchant payouts, balance transactions, payout requests
