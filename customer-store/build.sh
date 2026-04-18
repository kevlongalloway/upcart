#!/bin/sh
set -e

# In the multi-tenant deploy model, the storefront is served from the SAME
# origin as the tenant's backend Worker (via the [assets] binding in
# backend/wrangler.toml). Leave API_BASE_URL empty — fetches will resolve to
# the current origin, which is the tenant's own Worker.
#
# For a standalone / cross-origin deploy (storefront on Pages, API on a
# different hostname), set API_BASE_URL at build time, e.g.:
#   API_BASE_URL="https://api.example.com" sh build.sh

printf 'window.BST_API_BASE="%s";\n' "${API_BASE_URL:-}" > config.js

echo "Generated config.js:"
cat config.js
