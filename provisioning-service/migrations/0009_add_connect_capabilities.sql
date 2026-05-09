-- Track per-tenant Stripe Connect capability flags so checkout can gate
-- destination charges on charges_enabled without an extra Stripe API call,
-- and so the dashboard can display the correct onboarding state.
ALTER TABLE tenants ADD COLUMN stripe_connect_charges_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN stripe_connect_payouts_enabled INTEGER NOT NULL DEFAULT 0;
