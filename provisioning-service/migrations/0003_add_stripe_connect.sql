-- Migration: 0003_add_stripe_connect
-- Adds Stripe Connect fields to the tenants table so each merchant can
-- connect their Stripe account for payouts.
--
-- stripe_connect_account_id stores the Connected Account ID (acct_xxx)
-- returned by Stripe when the merchant completes the Connect OAuth flow
-- or Account Links onboarding.
--
-- stripe_connect_onboarding_complete is set to 1 once Stripe confirms
-- the account has completed all required verification steps (identity,
-- bank account, etc.) and is ready to receive payouts.

ALTER TABLE tenants ADD COLUMN stripe_connect_account_id          TEXT;
ALTER TABLE tenants ADD COLUMN stripe_connect_onboarding_complete INTEGER NOT NULL DEFAULT 0;
