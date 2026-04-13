#!/bin/sh
set -e

if [ -z "${API_BASE_URL}" ]; then
  echo "WARNING: API_BASE_URL is not set. config.js will have an empty base URL."
fi

printf 'window.BST_API_BASE="%s";\n' "${API_BASE_URL:-}" > config.js

echo "Generated config.js:"
cat config.js
