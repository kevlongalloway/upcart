# BLACKSTAR — TODO

## Checkout & Payment

- [ ] **Order confirmation page** (`success.html`) — a branded page to land on after
  Stripe redirects back with `?payment=success`. Currently falls back to
  `index.html` with a toast; a dedicated page should show the order summary,
  session ID from the URL query param, and a "Continue Shopping" CTA.

- [ ] **Checkout flow — hosted Stripe session** — the `hostedCheckout()` function
  in `cart.html` is wired up and calls `POST /checkout/session`. Needs end-to-end
  testing once the `API_BASE_URL` env var is configured on Render.

- [ ] **Payment Intent / custom checkout form** — optionally replace (or augment)
  the hosted Stripe redirect with an embedded `<StripeElement>` payment form so
  customers never leave the page. Uses `POST /checkout/intent` → `clientSecret`.

- [ ] **Apple Pay / Google Pay** — the Payment Request Button is implemented in
  `cart.html`. Requires:
  1. Stripe Dashboard → Payment methods → Apple Pay → Add domain
  2. Host `/.well-known/apple-developer-merchantid-domain-association` in repo root

- [ ] **Cancel URL** — verify `cancelUrl` sent to `/checkout/session` correctly
  returns the customer to `cart.html` with the cart intact.

## Product Experience

- [ ] **Product image gallery** — `product.html` only shows `images[0]`. Add a
  thumbnail strip or swipe gallery for products with multiple images.

- [ ] **Out-of-stock guard at checkout** — prevent the Checkout button from being
  clicked when all cart items are out of stock (`stock === 0`).

- [ ] **Sold-out badge on product cards** — show a "Sold Out" overlay on product
  grid cards when `stock === 0`.

## Infrastructure

- [ ] **Set `API_BASE_URL` on Render** — go to the Render dashboard →
  `blackstar-site` → Environment → add `API_BASE_URL` with your Cloudflare
  Worker URL (e.g. `https://my-worker.workers.dev`). Trigger a redeploy.

- [ ] **CORS origin** — ask the backend operator to add
  `https://blackstarthebrand.onrender.com` to `CORS_ORIGINS` in `wrangler.toml`
  and redeploy the worker.

- [ ] **Local development** — for local dev, edit `config.js` directly:
  ```js
  window.BST_API_BASE = 'https://your-worker.workers.dev';
  ```
  The Render build overwrites this file from `API_BASE_URL` automatically.

- [ ] **Remove legacy scraper** — `scraper.js`, `products.json`, and
  `.github/workflows/scrape-products.yml` are no longer needed now that products
  come from the API. Remove them when ready to clean up.
