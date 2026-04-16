# Landing Page

The public sign-up flow for Upcart. A single static HTML page that walks a new
merchant through store details → admin credentials → confirmation, then calls
the provisioning service to spin up their store.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The full multi-step signup wizard, inline JS + markup. |
| `style.css` | Dark-mode theme on top of Bootstrap 5. |

No build step and no dependencies — open `index.html` in a browser and it
works, as long as the provisioning API is reachable.

---

## How it works

1. **Step 1 — Store details**: name, subdomain, description, currency, country, theme.
   - Subdomain availability is checked via
     `GET {PROVISION_URL}/provision/check-subdomain?name=<slug>` as the user types.
2. **Step 2 — Admin credentials**: email, username, password.
3. **Step 3 — Review**: read-only summary of what's about to be provisioned.
4. **Submit**: `POST {PROVISION_URL}/provision` with the collected state.
5. **Poll**: `GET {PROVISION_URL}/provision/:tenant_id/status` every 3 s
   (up to 3 min) until status is `active` or `failed`.
6. **Success**: show the merchant their new `store_url` and `admin_url`.

---

## Configuration

The provisioning API URL is **hard-coded** as a constant in `index.html`:

```js
const PROVISION_URL = 'https://provision.upcart.online';
```

If you host the provisioning service elsewhere, edit that line before
deploying. There is no build step and no environment-variable injection.

---

## Deployment

Deploy as a **static site** on any host:

### Render

1. Create a new Static Site.
2. **Publish Directory:** `landing`
3. No build command needed.

### Cloudflare Pages

1. Create a new project from GitHub.
2. **Build command:** leave blank.
3. **Build output directory:** `landing`

### Custom domain

Point your root domain (e.g. `upcart.online`) at the static host. Each
provisioned store will be a subdomain under the same zone
(`<subdomain>.upcart.online`), served by the backend Worker.

---

## Known gaps

- **No automated tests.** Manual testing only — try the flow with a throwaway subdomain after any change.
- **No loading skeletons** between steps — transitions are instant.
- **No client-side password-strength hints** beyond the minimum length check.
- **API URL is hard-coded** — moving it into a config file would make it easier to deploy staging/prod copies.
