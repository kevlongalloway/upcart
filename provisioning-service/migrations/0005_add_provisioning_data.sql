-- Stash the original POST /provision payload (store config + admin config +
-- stripe key) on the tenant row so we can re-issue the tenant worker's
-- /setup call later — specifically, when the merchant first signs in to the
-- dashboard. This lets us keep POST /provision fast (just the Cloudflare
-- API steps) and avoid the long ctx.waitUntil that was getting killed
-- mid-flow during /setup, leaving stores stuck in "finalizing".

ALTER TABLE tenants ADD COLUMN provisioning_data TEXT;
