#!/usr/bin/env node
// Walks ../customer-store/ and uploads every file to the WORKER_BUNDLES R2
// bucket under the STOREFRONT_BUNDLE_PREFIX (default "storefront/"). The
// provisioning service re-uploads these bytes to each new tenant's Worker
// as static assets, so each tenant's subdomain serves the storefront + API
// from the same origin.
//
// Usage:  npm run storefront:upload
// Env:
//   BUCKET  — R2 bucket name (default: upcart-worker-bundles)
//   PREFIX  — R2 key prefix (default: storefront/)
//   SRC     — source directory (default: ../customer-store)

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BUCKET = process.env.BUCKET ?? "upcart-worker-bundles";
const PREFIX = (process.env.PREFIX ?? "storefront/").replace(/^\/+/, "");
const SRC    = process.env.SRC    ?? join(import.meta.dirname, "..", "..", "customer-store");

// Files not worth shipping to tenants.
const SKIP_FILES = new Set(["README.md", "TODO.md", "build.sh", ".gitignore", ".DS_Store"]);
const SKIP_DIRS  = new Set([".git", "node_modules"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st  = statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(abs);
    } else {
      if (SKIP_FILES.has(entry)) continue;
      yield abs;
    }
  }
}

let count = 0;
for (const abs of walk(SRC)) {
  const rel = relative(SRC, abs).split(sep).join("/");
  const key = `${PREFIX}${rel}`;
  console.log(`→ ${key}`);
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", abs, "--remote"],
    { stdio: "inherit" }
  );
  count++;
}

if (count === 0) {
  console.error(`No files found under ${SRC}`);
  process.exit(1);
}
console.log(`\nUploaded ${count} file(s) to ${BUCKET}/${PREFIX}`);
