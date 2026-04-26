-- Migration: 0006_add_payment_method
-- Stores the Stripe payment_method_id collected during the signup
-- $1 authorization flow. Used for future subscription charges so the
-- merchant doesn't need to re-enter card details.

ALTER TABLE tenants ADD COLUMN payment_method_id TEXT;
