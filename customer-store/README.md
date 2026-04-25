# Customer Store

The shopper-facing storefront for an Upcart store. A zero-framework static
site — plain HTML, CSS, and JS — that talks directly to the backend Worker for
products, discounts, and Stripe checkout.

---

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page with featured products (first 6). |
| `products.html` | Full catalog with pagination. |
| `product.html` | Product detail + add to cart. |
| `cart.html` | Cart view + Stripe checkout (hosted, Payment Request Button). |
| `success.html` | Post-purchase confirmation (currently minimal). |

## Shared scripts

| File | Purpose |
|------|---------|
| `config.js` | Sets `window.BST_API_BASE` (backend URL) and `window.STORE_THEME`. Generated at build time by `build.sh`. |
| `cart.js` | `localStorage`-backed cart (`bst_cart` key), quantity helpers, price formatting, nav-count updater. |
| `theme.js` | Applies CSS variables based on `window.STORE_THEME`. Five presets: `mono`, `minimal`, `boutique`, `bold`, `studio`. |
| `themes/` | Static theme assets (fonts, accent styles). |
| `build.sh` | Reads `API_BASE_URL` from the environment and writes `config.js`. |
| `render.yaml` | Render static-site configuration. |

Every HTML page loads `config.js` → `theme.js` → `cart.js` → inline page logic,
so `API_BASE` is always defined by the time fetches run.

---

## Quick start (local)

```bash
cd customer-store
cp .env.example .env
# edit .env and set API_BASE_URL

API_BASE_URL=https://<your-worker>.workers.dev sh build.sh
python3 -m http.server 8080
# open http://localhost:8080
```

Or, for a no-build workflow during development, edit `config.js` directly:

```js
window.BST_API_BASE = 'https://<your-worker>.workers.dev';
window.STORE_THEME  = 'mono';
```

`build.sh` will overwrite this file on the next build.

---

## Configuration

| Var | Required | Description |
|-----|----------|-------------|
| `API_BASE_URL` | **yes** | Full URL of the backend Worker, no trailing slash. Written into `config.js` at build time. |

The storefront fetches everything it needs from this one origin — products,
discount validation, checkout session creation, order lookups after redirect
from Stripe. Make sure the backend's `CORS_ORIGINS` contains this site's
origin before deploying to production.

---

## Deployment

### Render (static site)

`render.yaml` is already configured:

```yaml
services:
  - type: web
    staticSite: true
    buildCommand: sh build.sh
    envVars:
      - key: API_BASE_URL
        sync: false       # set this value in the Render dashboard
```

1. Push the repo to GitHub.
2. Create a new **Static Site** on Render; it will auto-detect `render.yaml`.
3. In **Environment**, set `API_BASE_URL` to your backend Worker's URL.
4. Deploy.

### Cloudflare Pages

1. **Build command:** `sh build.sh`
2. **Build output directory:** `customer-store`
3. **Environment variables:** `API_BASE_URL=https://<your-worker>.workers.dev`

---

## Backend API it depends on

All calls are unauthenticated (the storefront is public):

| Method | Path | Used on |
|--------|------|---------|
| `GET` | `/products?limit&offset` | `index.html`, `products.html` |
| `GET` | `/products/:id` | `product.html`, stock guard on `cart.html` |
| `POST` | `/discounts/validate` | cart discount input |
| `POST` | `/checkout/intent` | Apple Pay / Google Pay button |
| `POST` | `/checkout/session` | "Checkout" button (hosted Stripe redirect) |

See [`../backend/API.md`](../backend/API.md) for full request/response shapes.

---

## Themes

Pick one via `window.STORE_THEME` (or, when provisioned via
[`../provisioning-service`](../provisioning-service), set it per-tenant in
`store_settings`):

| Theme | Vibe |
|-------|------|
| `mono` | Editorial monochrome — Space Mono + Bebas Neue. |
| `minimal` | Clean, lots of whitespace. |
| `boutique` | Warm, serif-forward. |
| `bold` | High-contrast, loud type. |
| `studio` | Neutral, photography-first. |

`theme.js` injects CSS custom properties before first paint, so there's no flash.

---

## Open work

See [`TODO.md`](./TODO.md) for a punch list. The biggest open items:

- **Order confirmation page** — `success.html` needs to hit
  `GET /orders/session/:id` and render the actual order summary.
- **Embedded checkout** (Payment Element) — only hosted redirect + Payment
  Request Button are implemented today.
- **Product image gallery** — `product.html` only shows `images[0]`.
- **Out-of-stock UI** — sold-out badges on the grid, hard block on the cart button.
- **Legacy cleanup** — `scraper.js` and `products.json` from the original
  Shopify-scraper version are no longer referenced anywhere and can be deleted.
