import { Hono } from "hono";
import { STOREFRONT_ASSETS } from "../generated/storefront.js";

// Serves the shopper-facing HTML/CSS/JS from the tenant worker itself so
// every <subdomain>.upcart.online works the moment provisioning finishes —
// no separate static-site deploy. Contents are generated at build time
// from ../customer-store/ by backend/build.mjs.

export const storefront = new Hono();

for (const [path, asset] of Object.entries(STOREFRONT_ASSETS)) {
  storefront.get(path, () =>
    new Response(asset.body, {
      headers: {
        "Content-Type":  asset.type,
        "Cache-Control": "public, max-age=300",
      },
    })
  );
}
