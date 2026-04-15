-- Migration: 0002_add_dns_tracking
-- Adds columns to track the three Cloudflare resources created during
-- subdomain provisioning so they can be cleaned up on deprovision:
--
--   cf_dns_record_id    — Cloudflare DNS record (AAAA proxied placeholder).
--                         Created explicitly before adding a Worker Route.
--                         NULL when the Custom Domains API was used instead
--                         (Custom Domains manages DNS automatically).
--
--   cf_custom_domain_id — Workers Custom Domain binding ID.
--                         Set when provisioning used addWorkerCustomDomain.
--                         NULL when the fallback route approach was used.
--
-- cf_route_id already existed from migration 0001; it is set only for the
-- fallback route approach and remains NULL when Custom Domains is used.
--
-- Exactly one of (cf_custom_domain_id, cf_route_id) will be non-NULL per
-- active tenant, depending on which domain binding method succeeded.

ALTER TABLE tenants ADD COLUMN cf_dns_record_id    TEXT;
ALTER TABLE tenants ADD COLUMN cf_custom_domain_id TEXT;
