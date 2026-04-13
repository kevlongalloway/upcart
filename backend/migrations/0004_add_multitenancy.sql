-- ─── Add tenant_id to all store data tables ───────────────────────────────────
--
-- In multi-tenant mode the backend worker resolves the requesting store's ID
-- from the subdomain (or custom domain) by querying the platform D1 database,
-- then filters every query with WHERE tenant_id = <store_id>.
--
-- For existing single-tenant deployments this migration is a no-op in practice
-- because no tenant_id is set yet; the tenant middleware falls back gracefully
-- when PLATFORM_DB is not bound.

-- Products
ALTER TABLE products ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

-- Orders
ALTER TABLE orders ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);

-- Order items (join through orders, but index helps JOINs)
ALTER TABLE order_items ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);

-- Discounts
ALTER TABLE discounts ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_discounts_tenant ON discounts(tenant_id);
