# Upcart Dashboard

The merchant-facing admin portal for Upcart. One deployment serves every
tenant — the shared dashboard figures out which store it's acting on from the
subdomain supplied in the URL, sessionStorage, or the login form, and talks to
that tenant's backend Worker over HTTPS.

---

## Architecture

The dashboard is a **static single-page app** written in vanilla JavaScript.
No server code — the entire `public/` directory is uploaded to Cloudflare
Pages and served as-is.

```
Browser ──► Cloudflare Pages (dashboard.upcart.online)
             └── serves public/ (SPA + _redirects SPA fallback)
   │
   └─── fetch("https://<subdomain>.upcart.online/api/...") ──► tenant Worker
        (JWT-protected, CORS allow-listed by the provisioning service)
```

| File | Purpose |
|------|---------|
| `public/index.html` | SPA shell (Bootstrap 5, Bootstrap Icons). |
| `public/app.js` | Entire SPA (~2.5k LOC): `Config`, `Auth`, `Api`, views, `Router`. |
| `public/style.css` | Custom theme on top of Bootstrap. |
| `public/_redirects` | `/* /index.html 200` so hash routes work on refresh. |

### Tenant discovery

`Config.load()` resolves the active tenant on every page load, in priority
order:

1. **`?subdomain=acme` in the URL** — set by the signup redirect and stripped
   from the address bar after it's consumed.
2. **`sessionStorage['upcart_subdomain']`** — persists the choice across
   reloads within the same tab.
3. **The login form** — if neither of the above yielded a subdomain the user
   types it in.

Once a subdomain is known, `Config.workerUrl` is fixed at
`https://<subdomain>.<baseDomain>/api` and every `Api._fetch` call is a
cross-origin request to that tenant's Worker.

`Config._inferBaseDomain()` strips the leading `dashboard.` label from
`location.hostname`, falling back to `upcart.online` on localhost. For local
dev against a non-default domain, add
`<meta name="upcart-base-domain" content="example.com">` to `index.html`.

### SPA routes (hash-based)

| Hash | View |
|------|------|
| `#/login` | Admin login (subdomain + username + password) |
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

## Local development

```bash
cd admin-dashboard
npx http-server public -p 3000 -c-1
```

Then open <http://localhost:3000>. On localhost `Config.baseDomain` defaults
to `upcart.online`, so the login form will talk to whichever real tenant
Worker you type a subdomain for. To point at a dev backend instead, add
`<meta name="upcart-base-domain" content="your-dev-domain.workers.dev">`
to `public/index.html`.

---

## Deployment (Cloudflare Pages)

1. In the Cloudflare dashboard, create a new **Pages** project and connect it
   to this repository.
2. **Build settings:**
   - Framework preset: **None**
   - Build command: _(leave blank)_
   - Build output directory: `admin-dashboard/public`
3. **Custom domain:** `dashboard.<your root domain>` (e.g.
   `dashboard.upcart.online`). The provisioning service embeds this hostname
   into each tenant Worker's CORS allow-list, so it must match exactly.

No environment variables are required — the dashboard figures everything out
from the URL at runtime.

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
- Unwraps the `{ ok, data, error }` envelope.
- Throws `ApiError` with status + details on failure.
- Redirects to `#/login` on 401.

See [`../backend/ADMIN_API.md`](../backend/ADMIN_API.md) for the full endpoint
reference.

---

## Known gaps

- **No tests.** Consider Playwright for end-to-end coverage of the key flows
  (login, create product, record order, create discount).
- **`app.js` is a single 2.5k-line file.** Splitting it into modules would
  make the views easier to maintain.
- **Token is stored in `sessionStorage`.** Fine for a single-tab session, but
  logging out in one tab won't sign other tabs out.
- **No client-side input validation.** The backend validates with Zod, but
  adding client-side checks would surface errors faster.
