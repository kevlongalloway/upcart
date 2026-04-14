# Upcart SaaS Platform — Implementation TODOs

## Overview

Upcart is a modern e-commerce SaaS platform that allows merchants to create and manage online stores without technical knowledge. The platform handles payments, inventory, orders, and shipping.

## Authentication & Onboarding

### Signup Flow ✓ (In Progress)
The merchant signup process is a multi-step onboarding with the following flow:

1. **Account Registration (Step 1)**
   - Collect merchant information: First name, last name, email, password
   - Collect business details: Business name, business category
   - Form validation on client-side and server-side
   - Check email uniqueness before allowing registration
   - Password requirements: minimum 8 characters

2. **Payout Setup (Step 2)**
   - Collect bank account information: Bank name, account holder name, account number, routing number
   - Securely store payout information (encrypt sensitive data in production)
   - Do NOT expose full account numbers in responses (only last 4 digits)

3. **Account Activation (Step 3)**
   - Upon successful signup, create merchant account
   - Initialize with **$100 starting balance** (1000 cents) for first transactions
   - This balance is NOT tied to Stripe — it's managed within Upcart's system
   - Issue JWT token for immediate login access
   - User redirected to dashboard

### Key Points About Signup Process
- **NO Stripe API Key Setup**: Unlike traditional e-commerce platforms, merchants do NOT manage their own Stripe API keys. This is handled at the platform level for security and simplicity.
- **Starting Balance Model**: Each new merchant receives a $100 starting balance in their Upcart account. This covers initial transaction costs while they set up their products and begin selling.
- **Bank Connection for Payouts**: Merchants connect their bank account during onboarding to receive payouts of their earnings. Payouts are processed separately from their starting balance.
- **Automatic Payment Handling**: Upcart processes all payments through its own Stripe account, not the merchant's. This means:
  - Customers pay Upcart
  - Upcart deducts transaction fees and payout the merchant's balance
  - Funds accumulate in the merchant's account until they request a payout

### Onboarding Pages
- **File**: `admin-dashboard/public/onboarding.html`
- **Design**: Modern dark theme with neon accents (matching landing page design)
- **Features**:
  - Three-step progress indicator
  - Smooth transitions between steps
  - Client-side validation with error messages
  - Responsive design (mobile, tablet, desktop)
  - Integration with `/api/auth/signup` endpoint

### Backend Signup Endpoint
- **File**: `backend/src/routes/merchantSignup.ts`
- **Route**: `POST /auth/signup`
- **Request Body**:
  ```json
  {
    "firstName": "string",
    "lastName": "string",
    "email": "string (unique)",
    "password": "string (min 8 chars)",
    "businessName": "string",
    "businessCategory": "string",
    "businessCategory": "clothing|electronics|physical|digital|services|other",
    "bankName": "string",
    "accountHolder": "string",
    "accountNumber": "string",
    "routingNumber": "string"
  }
  ```
- **Success Response** (201):
  ```json
  {
    "ok": true,
    "data": {
      "merchant_id": "merchant_...",
      "token": "eyJhbGc...",
      "email": "user@example.com",
      "business_name": "My Store",
      "balance": 10000,
      "message": "Account created successfully. You have a $100 starting balance."
    }
  }
  ```

---

## Merchant Dashboard

### Login
- **File**: `admin-dashboard/public/index.html`
- **Route**: `/login` (to be created)
- Merchants login with email and password
- JWT token returned and stored in sessionStorage
- Redirect to dashboard on successful login

### Dashboard Features (TODO)
- [ ] View starting balance and account balance
- [ ] Track account balance changes (transactions, payouts)
- [ ] Manage payout settings (update bank account)
- [ ] View upcoming payouts
- [ ] Request immediate payout (if balance threshold met)
- [ ] View transaction history

---

## Payment Processing

### Transaction Flow
1. Customer submits payment through store checkout
2. Stripe processes payment through Upcart's account
3. Transaction fee deducted from merchant's balance
4. Remaining amount added to merchant's account balance
5. Merchant can payout when balance threshold is met

### Balance Management (TODO)
- [ ] Create balance management endpoints
- [ ] Implement transaction logging
- [ ] Setup payout processing (bank transfers)
- [ ] Handle failed payouts and retries
- [ ] Create audit trail for all balance changes

### Database Schema (TODO)
```sql
-- Merchants table
CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_category TEXT,
  balance INTEGER DEFAULT 10000, -- in cents ($100)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Payout information table
CREATE TABLE merchant_payouts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  bank_name TEXT,
  account_holder TEXT,
  account_number_encrypted TEXT, -- store encrypted, display last 4
  routing_number_encrypted TEXT,
  verified BOOLEAN DEFAULT FALSE,
  created_at DATETIME,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

-- Balance transactions table
CREATE TABLE balance_transactions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount INTEGER, -- in cents (positive = credit, negative = debit)
  transaction_type TEXT, -- 'sale', 'payout', 'refund', 'fee'
  reference_id TEXT, -- order_id, payout_id, etc.
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
```

---

## Security Considerations

### Data Protection
- [ ] Encrypt bank account details using AES-256 or similar
- [ ] Hash passwords using bcrypt or Argon2
- [ ] Never log or expose full account numbers
- [ ] Implement rate limiting on signup endpoint
- [ ] Add CAPTCHA to prevent automated signup abuse

### API Security
- [ ] Validate all input on server-side (in addition to client-side)
- [ ] Implement request signing for payout endpoints
- [ ] Add IP whitelisting for sensitive operations
- [ ] Implement API key rotation for service accounts
- [ ] Use HTTPS everywhere (required)

### Compliance
- [ ] Implement PCI-DSS compliance for payment handling
- [ ] Add KYC/KYB verification for high-risk merchants
- [ ] Implement AML checks for suspicious activity
- [ ] Setup audit logging for all sensitive operations
- [ ] Create data retention and deletion policies

---

## Development Roadmap

### Phase 1: Core Onboarding ✓ (Current)
- [x] Create onboarding HTML with landing page design
- [x] Create merchant signup endpoint
- [x] Implement three-step onboarding flow
- [x] Starting balance initialization ($100)
- [x] Bank account collection

### Phase 2: Merchant Authentication (TODO)
- [ ] Implement merchant login endpoint
- [ ] Create login page UI
- [ ] Add password reset functionality
- [ ] Setup email verification (optional but recommended)
- [ ] Implement session management

### Phase 3: Balance & Payout Management (TODO)
- [ ] Create balance endpoints (GET merchant balance)
- [ ] Implement transaction logging
- [ ] Create payout request endpoint
- [ ] Integrate with Stripe for bank transfers
- [ ] Build payout tracking dashboard

### Phase 4: Admin Features (TODO)
- [ ] Create admin dashboard for platform management
- [ ] Merchant account management and suspension
- [ ] Balance adjustment tools
- [ ] Dispute resolution interface
- [ ] Analytics and reporting

### Phase 5: Advanced Features (TODO)
- [ ] Multi-currency support
- [ ] Subscription-based pricing
- [ ] Affiliate program
- [ ] Advanced analytics
- [ ] Custom domain support

---

## Testing Checklist

### Signup Flow
- [ ] Test all validation rules
- [ ] Test duplicate email detection
- [ ] Test weak password rejection
- [ ] Test form step navigation
- [ ] Test error message display
- [ ] Test mobile responsiveness
- [ ] Test accessibility (keyboard navigation, screen readers)

### Backend API
- [ ] Test 201 response on successful signup
- [ ] Test 409 response on duplicate email
- [ ] Test 400 response on invalid input
- [ ] Test JWT token generation and validity
- [ ] Test starting balance initialization
- [ ] Load test signup endpoint

### Security
- [ ] Test SQL injection prevention
- [ ] Test XSS prevention in forms
- [ ] Test CSRF protection
- [ ] Test rate limiting
- [ ] Test password encryption

---

## Deployment

### Environment Variables Required
```
ADMIN_USERNAME=admin_email@example.com
ADMIN_PASSWORD=secure_password
JWT_SECRET=your_jwt_secret_key
CORS_ORIGINS=https://yourdomain.com,http://localhost:3000
DB_ADAPTER=d1 # or 'mongodb'
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Database Migrations
- [ ] Create merchants table
- [ ] Create merchant_payouts table
- [ ] Create balance_transactions table
- [ ] Create merchants email index
- [ ] Setup database backups

---

## Documentation

### For Merchants
- [ ] Getting started guide
- [ ] FAQ about starting balance and payouts
- [ ] Bank connection guide
- [ ] Payout schedule documentation
- [ ] Troubleshooting guide

### For Developers
- [ ] API documentation for signup endpoint
- [ ] Database schema documentation
- [ ] Architecture overview
- [ ] Deployment guide
- [ ] Contribution guidelines

---

## Known Limitations & Future Improvements

1. **Bank Account Encryption**: Currently, bank details are stored with basic encryption. Consider hardware security modules for production.

2. **Payout Processing**: Bank transfers need to be integrated with Stripe Connect or similar service. Currently placeholder only.

3. **Email Verification**: Consider requiring email verification before account activation for security.

4. **Two-Factor Authentication**: Add optional 2FA for additional security.

5. **Rate Limiting**: Currently no rate limiting on signup endpoint. Add before production.

6. **Starting Balance**: Currently fixed at $100. Consider making configurable or dynamic based on tier.

7. **Business Category**: Used for basic segmentation. Could be extended for tier-based pricing.

8. **Payout Verification**: Bank account details not verified until first payout. Implement micro-deposits for verification.

---

## Support & Maintenance

- Set up monitoring for signup endpoint performance
- Track signup funnel metrics (drop-off rates per step)
- Monitor authentication failures
- Setup alerts for suspicious activity (multiple failed logins, etc.)
- Regular security audits (quarterly minimum)
- Backup database daily
- Review logs for errors and edge cases weekly

