# Admin Dashboard

The merchant-facing admin portal for Upcart. Lets store operators log in, manage
products, orders, and discount codes, and (on first run) complete the
store-setup wizard.

---

## Architecture

The dashboard is a **single-page app** written in vanilla JavaScript, served by
a minimal **Express** wrapper. It talks to the backend Cloudflare Worker over
HTTPS using a short-lived JWT obtained via `POST /admin/login`.

```
Browser ──► Express (server.js)
             ├── serves static assets from public/
             └── GET /config → { workerUrl } read from env
                              (lets the SPA discover the backend URL)
   │
   └─── fetch(workerUrl + /admin/**) ──► Backend Worker (JWT-protected)
```

| File | Purpose |
|------|---------|
| `server.js` | Express dev/prod server. Serves `public/` and exposes `GET /config`. |
| `public/index.html` | SPA shell (Bootstrap 5, Bootstrap Icons). |
| `public/onboarding.html` | First-run setup wizard shown until `/setup/status` returns `configured: true`. |
| `public/app.js` | Entire SPA (~2.5k LOC): `Config`, `Auth`, `Api`, views, `Router`. |
| `public/style.css` | Custom theme on top of Bootstrap. |

### SPA routes (hash-based)

| Hash | View |
|------|------|
| `#/login` | Admin login form |
| `#/products` | Products list |
| `#/products/new` | Create product |
| `#/products/:id/edit` | Edit product |
| `#/orders` | Orders list |
| `#/orders/:id` | Order detail (fulfillment, shipping label) |
| `#/discounts` | Discounts list |
| `#/discounts/new` | Create discount code |
| `#/discounts/:id/edit` | Edit discount code |

All non-`/login` routes require a valid JWT; a 401 from the backend clears the
token and redirects to `/login`.

---

## Quick start (local)

```bash
cd admin-dashboard
npm install
cp .env.example .env
# edit .env and set WORKER_URL
npm run dev    # auto-reloads on file change
# or
npm start
```

Dashboard runs at <http://localhost:3000>. Log in with the `ADMIN_USERNAME` /
`ADMIN_PASSWORD` you configured on the backend Worker.

---

## Environment variables

| Var | Required | Description |
|-----|----------|-------------|
| `WORKER_URL` | **yes** | Full URL of the backend Worker, no trailing slash. The SPA fetches this from `GET /config`. |
| `PORT` | no | Express port (default `3000`). |

If `WORKER_URL` is missing, `GET /config` returns `500` and the SPA shows a
"Configuration Error" screen instead of the login form.

---

## Deployment

### Render (static + Node)

1. Create a new **Web Service** (not Static Site — the `/config` endpoint needs Node).
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. **Environment:** add `WORKER_URL=https://<your-worker>.workers.dev`

### Cloudflare Pages + Functions

Pages can host the static files, but you'd need to rewrite `server.js` as a
Pages Function. The simplest path is to keep the Express server on Render or
Fly and point your domain at it.

---

## API client

The SPA wraps every authenticated call through `Api._fetch()`:

```js
Api._fetch('/admin/products')        // GET
Api._fetch('/admin/products', {      // POST/PUT/DELETE
  method: 'POST',
  body: JSON.stringify({ ... }),
})
```

- Automatically attaches `Authorization: Bearer <token>`.
- Unwraps `{ ok, data, error }` envelope.
- Throws `ApiError` with status + details on failure.
- Redirects to `#/login` on 401.

See [`../backend/ADMIN_API.md`](../backend/ADMIN_API.md) for the full endpoint
reference.

---

## Known gaps

- **No tests.** Consider Playwright for end-to-end coverage of the key flows
  (login, create product, record order, create discount).
- **`app.js` is a single 2.5k-line file.** Splitting it into modules would make
  the views easier to maintain.
- **Token is stored in `sessionStorage`.** Fine for a single-tab session, but
  logging out in one tab won't sign other tabs out.
- **No client-side input validation.** The backend validates with Zod, but
  adding client-side checks would surface errors faster.
