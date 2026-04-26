# Upcart — Implementation Roadmap

## Pre-Provisioning Payment Verification ($1 Auth Charge)

- [x] Add a Stripe Payment Intent step (`amount: 100`, `capture_method: manual`) to the signup wizard before any cloud resources are provisioned
- [x] Only proceed to provision (Worker, D1, R2, DNS) after the $1 authorization succeeds
- [x] Capture and immediately refund the $1 hold once provisioning completes successfully
- [x] If the card declines, show a clear error and do not spin up any resources
- [x] Store the `payment_method_id` on the tenant record for future subscription charges
- [x] Gate: no provisioning without a valid payment method on file
- [x] "Start free trial" button label on Step 3 CTA

### Implementation notes
- New endpoint: `POST /provision/verify-payment` — creates the PaymentIntent and returns `client_secret`
- Stripe Elements card form mounted in Step 3 of the signup wizard
- `POST /provision` validates PaymentIntent is `requires_capture` before creating any Cloudflare resources
- Capture + refund runs inside `runProvisioning` after tenant goes live (non-fatal on failure)
- `payment_method_id` stored on the `tenants` table (migration `0006_add_payment_method.sql`)
