# Upcart Dashboard

The **central, multi-tenant admin portal** for Upcart merchants, deployed at
`dashboard.upcart.online`. Every merchant on the platform logs in here —
there is no per-store dashboard deployment.

After authentication the SPA talks **directly** to the merchant's own
Cloudflare Worker (e.g. `https://mystore.upcart.online`), discovered from
the provisioning service at login time.

---

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │  dashboard.upcart.online             │
                  │  (this app — one deployment)         │
                  └──────────────────────────────────────┘
                              │
                    ①  POST /auth/login {email,password}
                              │
                              ▼
              ┌──────────────────────────────────────────┐
              │  provision.upcart.online                 │
              │  — resolves email → worker_url           │
              │  — proxies login to the tenant's worker  │
              │  — returns JWT + worker_url + store info │
              └──────────────────────────────────────────┘
                              │
                    ②  Browser stores worker_url + JWT
                              │
                              ▼
         ┌─────────────────────────────────────────────────┐
         │  <subdomain>.upcart.online (tenant's worker)    │
         │  — /admin/* endpoints used from the browser     │
         └─────────────────────────────────────────────────┘
```

The Express `server.js` only serves static files and exposes a small
`/config` endpoint so the SPA can discover the provisioning service URL.
No requests are proxied through Express.

| File | Purpose |
|------|---------|
| `server.js` | Minimal Express server. Serves `public/` + `/config`. |
| `public/index.html` | SPA shell (Bootstrap 5, Bootstrap Icons). |
| `public/app.js` | Entire SPA: `Config`, `Auth`, `Api`, views, `Router`. |
| `public/style.css` | Custom theme on top of Bootstrap. |

### SPA routes (hash-based)

| Hash | View |
|------|------|
| `#/login` | Central login (email + password) |
| `#/products` | Products list |
| `#/products/new` | Create product |
| `#/products/:id/edit` | Edit product |
| `#/orders` | Orders list |
| `#/orders/:id` | Order detail (fulfillment, shipping label) |
| `#/discounts` | Discounts list |
| `#/discounts/new` | Create discount code |
| `#/discounts/:id/edit` | Edit discount code |
| `#/theme` | Storefront theme editor (preset + brand colors + logo) |

All non-`/login` routes require a valid JWT; a 401 from the merchant's
worker clears the session and redirects to `/login`.

---

## Quick start (local)

```bash
cd admin-dashboard
npm install
cp .env.example .env
# edit .env and point PROVISION_URL at a running provisioning-service
npm run dev
# or
npm start
```

Dashboard runs at <http://localhost:3000>. Log in with the email / password
a merchant used to sign up via the landing page.

---

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `3000` | Express port. |
| `PROVISION_URL` | `https://provision.upcart.online` | Provisioning service — exposes `POST /auth/login`. |
| `BASE_DOMAIN` | `upcart.online` | Root platform domain. |
| `SIGNUP_URL` | `https://upcart.online` | Where the "Don't have a store? Sign up" link points. |

No `WORKER_URL` is needed — the SPA discovers each merchant's worker
from the login response.

---

## Deployment

Recommended: **Cloudflare Pages** (static hosting) + a bind to the
`dashboard.upcart.online` custom domain.

If you need the `/config` endpoint with env-driven config, use **Render**
(Web Service, not Static Site) with the env vars above.

---

## Known gaps

- **No tests.** Consider Playwright for login + create product + theme edit.
- **`app.js` is a single ~2.8k-line file.** Splitting into ES modules is a
  worthy refactor.
- **Token is stored in `sessionStorage`.** Fine for a single-tab session;
  logging out in one tab won't sign out others.
- **No client-side input validation.** The backend validates with Zod,
  but adding checks would surface errors faster.
