-- Migration: 0002_add_dns_tracking  (NO-OP)
--
-- Historically added cf_dns_record_id + cf_custom_domain_id to `tenants`.
-- Those columns are now declared directly in 0001_create_tenants.sql, so this
-- migration would fail on a fresh database with:
--     "duplicate column name: cf_dns_record_id"
--
-- The file is kept (instead of deleted) so databases that previously applied
-- 0002 don't see the migration history shift and re-run later ones.
--
-- Safe no-op statement so wrangler still records the migration as applied.

SELECT 1;
