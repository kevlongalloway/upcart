/* =============================================================
   Blackstar Admin Dashboard
   ============================================================= */
'use strict';

// ── Config ─────────────────────────────────────────────────────
//
// Upcart's admin dashboard is a shared SaaS SPA: one deployment at
// dashboard.<BASE_DOMAIN> serves every merchant. Each merchant's backend
// Worker lives at a different subdomain (<subdomain>.<BASE_DOMAIN>), so
// the dashboard needs to know which tenant it's acting for on every
// request. We learn that from, in order:
//   1. a ?subdomain=… query param (used by the signup redirect), or
//   2. a previously-stored value in sessionStorage, or
//   3. the login form, once the user types it.
//
// Once we have a subdomain, workerUrl is fixed at
//   https://<subdomain>.<BASE_DOMAIN>/api
// and every API call is a cross-origin fetch allowed by the CORS rule
// baked into that tenant's Worker by the provisioning service.

const Config = {
  workerUrl:  null,
  subdomain:  null,
  baseDomain: null,

  _subKey: 'upcart_subdomain',

  _inferBaseDomain() {
    // Explicit override for local dev: <meta name="upcart-base-domain" content="…">.
    const meta = document.querySelector('meta[name="upcart-base-domain"]');
    if (meta?.content) return meta.content;

    const host = location.hostname;
    if (!host || host === 'localhost' || host.startsWith('127.') || host.endsWith('.local')) {
      return 'upcart.online';
    }
    // dashboard.foo.com → foo.com; dashboard.foo.co.uk → foo.co.uk
    const parts = host.split('.');
    if (parts[0] === 'dashboard' && parts.length >= 2) return parts.slice(1).join('.');
    // Fallback: last two labels (works for *.upcart.online under dashboard).
    return parts.slice(-2).join('.');
  },

  _subdomainFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      return params.get('subdomain');
    } catch { return null; }
  },

  setSubdomain(sub) {
    const clean = String(sub || '').toLowerCase().trim();
    if (!clean) throw new Error('Store subdomain is required');
    sessionStorage.setItem(this._subKey, clean);
    this.subdomain = clean;
    this.workerUrl = `https://${clean}.${this.baseDomain}/api`;
  },

  clearSubdomain() {
    sessionStorage.removeItem(this._subKey);
    this.subdomain = null;
    this.workerUrl = null;
  },

  hasSubdomain() { return !!this.subdomain; },

  load() {
    this.baseDomain = this._inferBaseDomain();

    const fromUrl = this._subdomainFromUrl();
    if (fromUrl) {
      // The URL wins — wipe any stale session. Strip it off the address bar
      // so the onboarding=1 param doesn't linger after reload.
      try {
        this.setSubdomain(fromUrl);
        const url = new URL(location.href);
        url.searchParams.delete('subdomain');
        history.replaceState({}, '', url.toString());
      } catch { /* ignore, fall through to stored/login */ }
      return;
    }

    const stored = sessionStorage.getItem(this._subKey);
    if (stored) {
      try { this.setSubdomain(stored); } catch { this.clearSubdomain(); }
    }
  },
};

// ── Auth ────────────────────────────────────────────────────────
const Auth = {
  _key: 'upcart_admin_token',

  // Legacy session from the single-tenant (Express) deploy — migrate if seen.
  _legacyKey: 'blackstar_admin_token',

  getToken() {
    return sessionStorage.getItem(this._key) ?? sessionStorage.getItem(this._legacyKey);
  },
  setToken(t)  { sessionStorage.setItem(this._key, t); sessionStorage.removeItem(this._legacyKey); },
  clearToken() { sessionStorage.removeItem(this._key); sessionStorage.removeItem(this._legacyKey); },
  isLoggedIn() { return !!this.getToken() && Config.hasSubdomain(); },

  async login(subdomain, username, password) {
    Config.setSubdomain(subdomain);
    const res  = await fetch(`${Config.workerUrl}/admin/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({ ok: false, error: 'Invalid response from store' }));
    if (!res.ok || !body.ok) {
      // Wrong subdomain or credentials — don't leave a half-set Config behind
      // that the rest of the app might key off of.
      Config.clearSubdomain();
      throw new ApiError(body.error || 'Sign in failed', res.status);
    }
    this.setToken(body.data.token);
  },

  logout() {
    this.clearToken();
    Config.clearSubdomain();
    Router.go('/login');
  },
};

// ── ApiError ────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;
    this.details = details;
  }
}

// ── Api ─────────────────────────────────────────────────────────
const Api = {
  async _fetch(path, opts = {}) {
    const token = Auth.getToken();
    const res = await fetch(`${Config.workerUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      if (res.status === 401) { Auth.clearToken(); Router.go('/login'); }
      throw new ApiError(body.error ?? 'Unknown error', res.status, body.details);
    }
    return body.data;
  },

  getProducts(params = {}) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(clean).toString();
    return this._fetch(`/admin/products${qs ? `?${qs}` : ''}`);
  },

  getProduct(id)       { return this._fetch(`/admin/products/${id}`); },
  createProduct(data)  { return this._fetch('/admin/products', { method: 'POST', body: JSON.stringify(data) }); },
  updateProduct(id, d) { return this._fetch(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  deleteProduct(id)    { return this._fetch(`/admin/products/${id}`, { method: 'DELETE' }); },

  async uploadImage(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${Config.workerUrl}/admin/images/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
      body:    form,
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new ApiError(body.error ?? 'Upload failed', res.status);
    return body.data; // { url, key }
  },

  deleteImage(key) {
    return this._fetch(`/admin/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
  },

  // Orders
  getOrders(params = {}) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const qs = new URLSearchParams(clean).toString();
    return this._fetch(`/admin/orders${qs ? `?${qs}` : ''}`);
  },

  getOrder(id)          { return this._fetch(`/admin/orders/${id}`); },
  updateOrder(id, data) { return this._fetch(`/admin/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },

  getOrderRates(id, params) {
    const qs = new URLSearchParams(params).toString();
    return this._fetch(`/admin/orders/${id}/rates?${qs}`);
  },

  generateShippingLabel(id, data) {
    return this._fetch(`/admin/orders/${id}/shipping-label`, { method: 'POST', body: JSON.stringify(data) });
  },

  // Discounts
  getDiscounts(params = {}) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const qs = new URLSearchParams(clean).toString();
    return this._fetch(`/admin/discounts${qs ? `?${qs}` : ''}`);
  },
  getDiscount(id)       { return this._fetch(`/admin/discounts/${id}`); },
  createDiscount(data)  { return this._fetch('/admin/discounts', { method: 'POST', body: JSON.stringify(data) }); },
  updateDiscount(id, d) { return this._fetch(`/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  deleteDiscount(id)    { return this._fetch(`/admin/discounts/${id}`, { method: 'DELETE' }); },
};

// ── Toast ───────────────────────────────────────────────────────
const Toast = {
  _container: null,
  _ensure() {
    if (this._container) return;
    this._container = Object.assign(document.createElement('div'), {
      className: 'toast-container position-fixed bottom-0 end-0 p-3',
    });
    this._container.style.zIndex = '9999';
    document.body.appendChild(this._container);
  },

  show(message, type = 'success') {
    this._ensure();
    const id    = `t${Date.now()}`;
    const icon  = type === 'success' ? 'bi-check-circle-fill text-success' : 'bi-exclamation-triangle-fill text-danger';
    const html  = `
      <div id="${id}" class="toast align-items-center border-secondary" role="alert">
        <div class="d-flex">
          <div class="toast-body d-flex align-items-center gap-2">
            <i class="bi ${icon}"></i>
            <span>${escHtml(message)}</span>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`;
    this._container.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    const t  = new bootstrap.Toast(el, { delay: 4000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
};

// ── Helpers ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(cents, currency = 'usd') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function parsePriceInput(input) {
  const n = parseFloat(String(input).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

function stockBadge(stock) {
  if (stock === -1) return '<span class="badge text-bg-secondary">Unlimited</span>';
  if (stock ===  0) return '<span class="badge text-bg-danger">Sold out</span>';
  if (stock <=   4) return `<span class="badge text-bg-warning">Only ${stock} left</span>`;
  return `<span class="badge text-bg-success">${stock} in stock</span>`;
}

function activeBadge(active) {
  return active
    ? '<span class="badge text-bg-success">Active</span>'
    : '<span class="badge text-bg-secondary">Inactive</span>';
}

function statusBadge(s) {
  const cls = { pending: 'text-bg-warning', paid: 'text-bg-success', fulfilled: 'text-bg-primary', cancelled: 'text-bg-secondary' };
  return `<span class="badge ${cls[s] ?? 'text-bg-secondary'}">${escHtml(s ?? '—')}</span>`;
}

function fulfillmentBadge(s) {
  const cls = { unfulfilled: 'text-bg-danger', processing: 'text-bg-warning', shipped: 'text-bg-info', delivered: 'text-bg-success' };
  return `<span class="badge ${cls[s] ?? 'text-bg-secondary'}">${escHtml(s ?? '—')}</span>`;
}

function currencySymbol(code) {
  return { usd: '$', eur: '€', gbp: '£' }[code] ?? code.toUpperCase();
}

// ── Confirm modal ───────────────────────────────────────────────
function confirmModal(title, bodyHtml, btnLabel = 'Delete', btnClass = 'btn-danger') {
  return new Promise(resolve => {
    const id  = `cm${Date.now()}`;
    const html = `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-sm modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${escHtml(title)}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn ${btnClass}" id="${id}-ok">${escHtml(btnLabel)}</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const el    = document.getElementById(id);
    const modal = new bootstrap.Modal(el);
    let confirmed = false;
    document.getElementById(`${id}-ok`).addEventListener('click', () => {
      confirmed = true;
      modal.hide();
    });
    el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(confirmed); });
    modal.show();
  });
}

// ── Shared navbar ───────────────────────────────────────────────
function renderNavbar() {
  const hash          = location.hash.replace(/^#/, '');
  const onOrders      = hash.startsWith('/orders');
  const onDiscounts   = hash.startsWith('/discounts');
  const onProducts    = !onOrders && !onDiscounts;
  return `
    <nav class="navbar border-bottom">
      <div class="container-fluid d-flex align-items-center justify-content-between" style="height:56px">
        <a class="navbar-brand" href="#/products">
          <img src="/IMG_1306.jpeg" alt="Blackstar" class="brand-logo">
          <span class="brand-sub ms-2">ADMIN</span>
        </a>
        <div class="d-flex align-items-center gap-2">
          <ul class="nav nav-pills d-flex gap-1 mb-0">
            <li class="nav-item">
              <a class="nav-link py-1 px-2 ${onProducts ? 'active' : ''}" href="#/products">
                <i class="bi bi-box-seam"></i><span class="nav-label ms-1">Products</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link py-1 px-2 ${onOrders ? 'active' : ''}" href="#/orders">
                <i class="bi bi-receipt"></i><span class="nav-label ms-1">Orders</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link py-1 px-2 ${onDiscounts ? 'active' : ''}" href="#/discounts">
                <i class="bi bi-tag"></i><span class="nav-label ms-1">Discounts</span>
              </a>
            </li>
          </ul>
          <button class="btn btn-outline-secondary btn-sm" id="logout-btn">
            <i class="bi bi-box-arrow-right"></i><span class="d-none d-sm-inline ms-1">Logout</span>
          </button>
        </div>
      </div>
    </nav>`;
}

// ═══════════════════════════════════════════════════════════════
// View: Login
// ═══════════════════════════════════════════════════════════════
const LoginView = {
  render() {
    const prefill = escHtml(Config.subdomain || '');
    const baseDomain = escHtml(Config.baseDomain || 'upcart.online');
    return `
      <div class="login-wrap">
        <div class="card login-card">
          <div class="card-body p-4 p-sm-5">
            <div class="text-center mb-4">
              <div class="login-logo">
                <img src="/IMG_1306.jpeg" alt="Upcart" class="login-brand-img">
              </div>
              <p class="mb-0 mt-2" style="font-size:0.65rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-muted)">Merchant Admin</p>
              <p class="text-secondary small mt-3 mb-0">Sign in to your store</p>
            </div>
            <div id="login-error" class="alert alert-danger d-none py-2 small" role="alert"></div>
            <form id="login-form" novalidate>
              <div class="mb-3">
                <label for="login-subdomain" class="form-label small fw-semibold">Store address</label>
                <div class="input-group">
                  <input type="text"
                         class="form-control"
                         id="login-subdomain"
                         placeholder="your-store"
                         autocomplete="organization"
                         spellcheck="false"
                         autocapitalize="none"
                         value="${prefill}"
                         required>
                  <span class="input-group-text">.${baseDomain}</span>
                </div>
              </div>
              <div class="mb-3">
                <label for="login-username" class="form-label small fw-semibold">Username</label>
                <input type="text" class="form-control" id="login-username" autocomplete="username" required>
              </div>
              <div class="mb-4">
                <label for="login-password" class="form-label small fw-semibold">Password</label>
                <input type="password" class="form-control" id="login-password" autocomplete="current-password" required>
              </div>
              <button type="submit" class="btn btn-primary w-100 fw-semibold" id="login-btn">
                Sign in
              </button>
            </form>
            <p class="text-center text-secondary small mt-4 mb-0">
              Don't have a store yet?
              <a href="https://${baseDomain}" class="text-decoration-none">Create one</a>
            </p>
          </div>
        </div>
      </div>`;
  },

  init() {
    const form   = document.getElementById('login-form');
    const btn    = document.getElementById('login-btn');
    const errEl  = document.getElementById('login-error');

    // Pre-fill subdomain if the URL provided one (signup redirect); focus
    // the next empty field so the merchant can just start typing.
    const subEl  = document.getElementById('login-subdomain');
    const userEl = document.getElementById('login-username');
    if (subEl.value) userEl.focus(); else subEl.focus();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const subdomain = subEl.value.trim().toLowerCase();
      const username  = userEl.value.trim();
      const password  = document.getElementById('login-password').value;
      if (!subdomain) {
        errEl.textContent = 'Enter your store address.';
        errEl.classList.remove('d-none');
        return;
      }
      errEl.classList.add('d-none');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in…';
      try {
        await Auth.login(subdomain, username, password);
        Router.go('/products');
      } catch (err) {
        errEl.textContent = err.message || 'Sign in failed';
        errEl.classList.remove('d-none');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Products List
// ═══════════════════════════════════════════════════════════════
const ProductsListView = {
  _offset:   0,
  _limit:    50,
  _filter:  'all',

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
          <div>
            <h1 class="fw-black mb-0" style="font-size:1.4rem;letter-spacing:-0.01em">Products</h1>
            <p class="mb-0 mt-1" style="font-size:0.75rem;color:var(--text-muted)">Manage your catalog</p>
          </div>
          <a href="#/products/new" class="btn btn-primary">
            <i class="bi bi-plus-lg me-1"></i>New Product
          </a>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group btn-group-sm" role="group" id="filter-group">
              <input type="radio" class="btn-check" name="filter" id="f-all"      value="all"      checked>
              <label class="btn btn-outline-secondary" for="f-all">All</label>
              <input type="radio" class="btn-check" name="filter" id="f-active"   value="active">
              <label class="btn btn-outline-secondary" for="f-active">Active</label>
              <input type="radio" class="btn-check" name="filter" id="f-inactive" value="inactive">
              <label class="btn btn-outline-secondary" for="f-inactive">Inactive</label>
            </div>
            <span class="text-secondary small" id="product-count"></span>
          </div>

          <div class="table-responsive">
            <table class="table table-dark table-hover align-middle mb-0 products-table">
              <thead>
                <tr>
                  <th class="ps-3">Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th class="pe-3">Actions</th>
                </tr>
              </thead>
              <tbody id="products-tbody">
                <tr>
                  <td colspan="6" class="text-center py-5">
                    <div class="spinner-border text-success" role="status">
                      <span class="visually-hidden">Loading…</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card-footer d-flex justify-content-between align-items-center" id="pagination-row">
            <button class="btn btn-sm btn-outline-secondary" id="prev-btn" disabled>
              <i class="bi bi-chevron-left me-1"></i>Previous
            </button>
            <span class="text-secondary small" id="page-info"></span>
            <button class="btn btn-sm btn-outline-secondary" id="next-btn" disabled>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async init() {
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

    document.getElementById('filter-group').addEventListener('change', e => {
      this._filter = e.target.value;
      this._offset = 0;
      this._load();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - this._limit);
      this._load();
    });
    document.getElementById('next-btn').addEventListener('click', () => {
      this._offset += this._limit;
      this._load();
    });

    document.getElementById('products-tbody').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, name, active } = btn.dataset;

      if (action === 'edit') {
        Router.go(`/products/${id}/edit`);
        return;
      }

      if (action === 'toggle') {
        const nowActive = active === 'true';
        btn.disabled = true;
        try {
          await Api.updateProduct(id, { active: !nowActive });
          Toast.success(`Product ${!nowActive ? 'activated' : 'deactivated'}`);
          this._load();
        } catch (err) {
          Toast.error(err.message);
          btn.disabled = false;
        }
        return;
      }

      if (action === 'delete') {
        const ok = await confirmModal(
          'Delete product',
          `<p class="mb-1">Permanently delete <strong>${escHtml(name)}</strong>?</p>
           <p class="text-warning small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>Consider deactivating instead to preserve checkout history.</p>`,
          'Delete permanently',
          'btn-danger'
        );
        if (!ok) return;
        try {
          await Api.deleteProduct(id);
          Toast.success('Product deleted');
          this._load();
        } catch (err) {
          Toast.error(err.message);
        }
      }
    });

    await this._load();
  },

  async _load() {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-5">
          <div class="spinner-border text-success" role="status"></div>
        </td>
      </tr>`;

    // For "inactive" filter: fetch all (no server-side filter) and filter client-side
    const isInactiveFilter = this._filter === 'inactive';
    const params = {
      limit:  isInactiveFilter ? 100 : this._limit,
      offset: isInactiveFilter ? 0   : this._offset,
      ...(this._filter === 'active' ? { active_only: 'true' } : {}),
    };

    try {
      let products = await Api.getProducts(params);

      if (isInactiveFilter) {
        products = products.filter(p => !p.active);
      }

      this._renderRows(products, isInactiveFilter);
      this._updatePagination(products.length, isInactiveFilter);
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-4 text-danger">
            <i class="bi bi-exclamation-circle me-2"></i>${escHtml(err.message)}
          </td>
        </tr>`;
    }
  },

  _renderRows(products, hidePagination = false) {
    const tbody    = document.getElementById('products-tbody');
    const countEl  = document.getElementById('product-count');
    const pageRow  = document.getElementById('pagination-row');

    pageRow.style.display = hidePagination ? 'none' : '';
    countEl.textContent   = `${products.length} product${products.length !== 1 ? 's' : ''}`;

    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-5 text-secondary">
            <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>
            No products found
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const thumb = p.images?.[0]
        ? `<img src="${escHtml(p.images[0])}" width="40" height="40" class="rounded" style="object-fit:cover" onerror="this.replaceWith(placeholder())">`
        : `<span class="d-inline-flex align-items-center justify-content-center rounded bg-secondary bg-opacity-25" style="width:40px;height:40px"><i class="bi bi-image text-secondary"></i></span>`;

      return `
        <tr>
          <td class="ps-3">
            <div class="d-flex align-items-center gap-3">
              ${thumb}
              <div>
                <div class="fw-semibold lh-sm">${escHtml(p.name)}</div>
                <div class="text-secondary font-monospace" style="font-size:0.7rem">${p.id.slice(0, 8)}…</div>
              </div>
            </div>
          </td>
          <td class="fw-semibold">${formatPrice(p.price, p.currency)}</td>
          <td>${stockBadge(p.stock)}</td>
          <td>${activeBadge(p.active)}</td>
          <td class="text-secondary small">${formatDate(p.created_at)}</td>
          <td class="pe-3">
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" title="Edit"
                      data-action="edit" data-id="${escHtml(p.id)}">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm ${p.active ? 'btn-outline-warning' : 'btn-outline-success'}"
                      title="${p.active ? 'Deactivate' : 'Activate'}"
                      data-action="toggle" data-id="${escHtml(p.id)}" data-active="${p.active}">
                <i class="bi bi-${p.active ? 'eye-slash' : 'eye'}"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" title="Delete"
                      data-action="delete" data-id="${escHtml(p.id)}" data-name="${escHtml(p.name)}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  _updatePagination(count, hidden) {
    if (hidden) return;
    const prevBtn  = document.getElementById('prev-btn');
    const nextBtn  = document.getElementById('next-btn');
    const pageInfo = document.getElementById('page-info');

    prevBtn.disabled = this._offset === 0;
    nextBtn.disabled = count < this._limit;

    if (count > 0) {
      pageInfo.textContent = `${this._offset + 1}–${this._offset + count}`;
    } else {
      pageInfo.textContent = '';
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Product Form (create + edit)
// ═══════════════════════════════════════════════════════════════
const ProductFormView = {
  _id:       null,
  _isNew:    false,
  _images:   [], // [{ url, key? }]
  _variants: [], // [{ size, stock }]

  render(id) {
    this._id     = id ?? null;
    this._isNew  = !id;
    this._images = [];

    const showForm    = this._isNew;
    const showLoader  = !this._isNew;

    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:700px">

        <div class="d-flex align-items-center gap-3 mb-4">
          <a href="#/products" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-arrow-left me-1"></i>Back
          </a>
          <h1 class="fw-black mb-0" id="form-title" style="font-size:1.3rem;letter-spacing:-0.01em">
            ${this._isNew ? 'New Product' : '<span style="color:var(--text-muted)">Loading…</span>'}
          </h1>
        </div>

        <!-- Loading state (edit only) -->
        <div id="form-loader" class="page-loader ${showLoader ? '' : 'd-none'}">
          <div class="spinner-border text-success"></div>
        </div>

        <!-- The form -->
        <form id="product-form" novalidate class="${showForm ? '' : 'd-none'}">

          <!-- Details card -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Product Details
            </div>
            <div class="card-body">

              <div class="mb-3">
                <label class="form-label small fw-semibold">
                  Name <span class="text-danger">*</span>
                </label>
                <input type="text" class="form-control" name="name" maxlength="255" required>
                <div class="invalid-feedback" data-field="name"></div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-semibold">Description</label>
                <textarea class="form-control" name="description" rows="3" maxlength="5000"></textarea>
              </div>

              <div class="row g-3 mb-3">
                <div class="col-sm-7">
                  <label class="form-label small fw-semibold">
                    Price <span class="text-danger">*</span>
                  </label>
                  <div class="input-group">
                    <span class="input-group-text" id="currency-symbol">$</span>
                    <input type="number" class="form-control" name="price_display"
                           step="0.01" min="0.01" placeholder="0.00" required>
                  </div>
                  <div class="invalid-feedback d-block d-none small" data-field="price"></div>
                </div>
                <div class="col-sm-5">
                  <label class="form-label small fw-semibold">Currency</label>
                  <select class="form-select" name="currency" id="currency-select">
                    <option value="usd">USD ($)</option>
                    <option value="eur">EUR (€)</option>
                    <option value="gbp">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div class="row g-3">
                <div class="col-sm-7">
                  <label class="form-label small fw-semibold">Stock</label>
                  <div class="input-group">
                    <input type="number" class="form-control" id="stock-input" name="stock" min="-1" value="-1" disabled>
                    <span class="input-group-text">
                      <div class="form-check mb-0">
                        <input class="form-check-input" type="checkbox" id="unlimited-check" checked>
                        <label class="form-check-label small text-secondary" for="unlimited-check">Unlimited</label>
                      </div>
                    </span>
                  </div>
                  <div class="form-text">-1 = unlimited &nbsp;·&nbsp; 0 = sold out</div>
                </div>
                <div class="col-sm-5 d-flex align-items-center pt-3">
                  <div class="form-check form-switch mt-2">
                    <input class="form-check-input" type="checkbox" id="active-toggle" name="active" checked>
                    <label class="form-check-label fw-semibold" for="active-toggle">Active / Visible</label>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Images card -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Images
            </div>
            <div class="card-body">
              <div id="image-gallery" class="d-flex flex-wrap gap-2 mb-3">
                <span class="text-secondary small">No images</span>
              </div>
              <div class="d-flex align-items-center gap-3 flex-wrap">
                <label class="btn btn-sm btn-outline-secondary mb-0" for="image-file-input">
                  <i class="bi bi-upload me-1"></i>Upload image
                  <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/webp,image/gif" class="d-none">
                </label>
                <span class="text-secondary small" id="upload-status"></span>
              </div>
              <div class="form-text">JPEG, PNG, WebP or GIF. The images array replaces existing images on save.</div>
            </div>
          </div>

          <!-- Variants / Sizes card -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between">
              Variants / Sizes
              <span class="fw-normal text-secondary">Size and stock combinations</span>
            </div>
            <div class="card-body">
              <div id="variants-container">
                <div class="table-responsive">
                  <table class="table table-sm table-borderless mb-3">
                    <thead>
                      <tr class="border-bottom">
                        <th class="text-secondary small fw-semibold">Size</th>
                        <th class="text-secondary small fw-semibold">Stock</th>
                        <th class="text-secondary small fw-semibold"></th>
                      </tr>
                    </thead>
                    <tbody id="variants-list">
                    </tbody>
                  </table>
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="add-variant-btn">
                <i class="bi bi-plus-lg me-1"></i>Add Size
              </button>
              <div class="form-text mt-3">Common sizes: S, M, L, XL. Or use custom sizes like "One Size", "32x24", etc.</div>
              <div class="mt-3 p-3 bg-dark rounded-2 border border-secondary small">
                <div class="text-secondary mb-2">JSON Preview:</div>
                <code id="variants-preview" class="text-success font-monospace">{ "variants": [] }</code>
              </div>
              <div class="invalid-feedback d-block d-none small mt-2" id="variants-error"></div>
            </div>
          </div>

          <!-- Metadata card (legacy) -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between">
              Metadata
              <span class="fw-normal text-secondary">Optional JSON key/value pairs</span>
            </div>
            <div class="card-body">
              <textarea class="form-control font-monospace small" id="metadata-input" name="metadata" rows="4"
                        placeholder='{ "sku": "WP-001", "weight_kg": 0.5 }'></textarea>
              <div class="invalid-feedback d-block d-none small mt-1" id="metadata-error"></div>
            </div>
          </div>

          <!-- Stripe info (edit only) -->
          <div id="stripe-info" class="d-none mb-4">
            <div class="card border-secondary">
              <div class="card-header small fw-semibold text-uppercase text-secondary">
                Stripe (read-only)
              </div>
              <div class="card-body">
                <div class="row g-2">
                  <div class="col-sm-6">
                    <label class="form-label small text-secondary mb-1">Stripe Product ID</label>
                    <input type="text" class="form-control form-control-sm font-monospace" id="stripe-product-id" readonly>
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label small text-secondary mb-1">Stripe Price ID</label>
                    <input type="text" class="form-control form-control-sm font-monospace" id="stripe-price-id" readonly>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="d-flex justify-content-end gap-2">
            <a href="#/products" class="btn btn-secondary">Cancel</a>
            <button type="submit" class="btn btn-primary px-4 fw-semibold" id="save-btn">
              <i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Product' : 'Save Changes'}
            </button>
          </div>

        </form>
      </div>`;
  },

  async init(id) {
    this._id    = id ?? null;
    this._isNew = !id;

    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

    // Currency symbol
    document.getElementById('currency-select').addEventListener('change', e => {
      document.getElementById('currency-symbol').textContent = currencySymbol(e.target.value);
    });

    // Unlimited stock toggle
    const unlimitedCheck = document.getElementById('unlimited-check');
    const stockInput     = document.getElementById('stock-input');
    unlimitedCheck.addEventListener('change', () => {
      if (unlimitedCheck.checked) {
        stockInput.value    = '-1';
        stockInput.disabled = true;
      } else {
        stockInput.value    = '0';
        stockInput.disabled = false;
        stockInput.focus();
      }
    });

    // Image upload
    document.getElementById('image-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const statusEl = document.getElementById('upload-status');
      statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Uploading…';
      try {
        const { url, key } = await Api.uploadImage(file);
        this._images.push({ url, key });
        this._renderGallery();
        statusEl.textContent = '';
        Toast.success('Image uploaded');
      } catch (err) {
        statusEl.textContent = '';
        Toast.error(`Upload failed: ${err.message}`);
      }
    });

    // Variants / Sizes
    document.getElementById('add-variant-btn').addEventListener('click', e => {
      e.preventDefault();
      this._addVariant();
    });
    this._renderVariants();

    // Load product data when editing
    if (!this._isNew) {
      try {
        const product   = await Api.getProduct(id);
        this._images    = (product.images ?? []).map(url => ({ url }));
        this._fillForm(product);
        document.getElementById('form-loader').classList.add('d-none');
        document.getElementById('product-form').classList.remove('d-none');
        document.getElementById('form-title').textContent = product.name;
      } catch (err) {
        document.getElementById('form-loader').innerHTML =
          `<div class="alert alert-danger">Failed to load product: ${escHtml(err.message)}</div>`;
      }
    } else {
      this._renderGallery();
    }

    // Submit
    document.getElementById('product-form').addEventListener('submit', async e => {
      e.preventDefault();
      await this._submit();
    });
  },

  _fillForm(p) {
    const form = document.getElementById('product-form');
    form.querySelector('[name=name]').value        = p.name ?? '';
    form.querySelector('[name=description]').value = p.description ?? '';
    form.querySelector('[name=price_display]').value = (p.price / 100).toFixed(2);

    const currEl = form.querySelector('[name=currency]');
    currEl.value = p.currency ?? 'usd';
    document.getElementById('currency-symbol').textContent = currencySymbol(currEl.value);

    const stockInput     = document.getElementById('stock-input');
    const unlimitedCheck = document.getElementById('unlimited-check');
    if (p.stock === -1) {
      unlimitedCheck.checked = true;
      stockInput.value       = '-1';
      stockInput.disabled    = true;
    } else {
      unlimitedCheck.checked = false;
      stockInput.value       = p.stock;
      stockInput.disabled    = false;
    }

    document.getElementById('active-toggle').checked = p.active !== false;

    // Variants / Sizes
    if (p.metadata && p.metadata.variants && Array.isArray(p.metadata.variants)) {
      this._variants = p.metadata.variants.map(v => ({
        size: v.size ?? '',
        stock: v.stock ?? 0
      }));
    } else {
      this._variants = [];
    }
    this._renderVariants();

    // Metadata (legacy, excluding variants)
    if (p.metadata && Object.keys(p.metadata).length > 0) {
      const metaCopy = { ...p.metadata };
      delete metaCopy.variants;
      if (Object.keys(metaCopy).length > 0) {
        document.getElementById('metadata-input').value = JSON.stringify(metaCopy, null, 2);
      }
    }

    // Stripe fields (read-only)
    if (p.stripe_product_id || p.stripe_price_id) {
      document.getElementById('stripe-info').classList.remove('d-none');
      document.getElementById('stripe-product-id').value = p.stripe_product_id ?? '—';
      document.getElementById('stripe-price-id').value   = p.stripe_price_id   ?? '—';
    }

    this._renderGallery();
  },

  _renderGallery() {
    const gallery = document.getElementById('image-gallery');
    if (!gallery) return;

    if (this._images.length === 0) {
      gallery.innerHTML = '<span class="text-secondary small">No images</span>';
      return;
    }

    gallery.innerHTML = this._images.map((img, i) => `
      <div class="img-thumb-wrap">
        <img src="${escHtml(img.url)}"
             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%2330363d%22 rx=%226%22/%3E%3Ctext x=%2240%22 y=%2248%22 text-anchor=%22middle%22 font-size=%2224%22%3E%F0%9F%96%BC%EF%B8%8F%3C/text%3E%3C/svg%3E'">
        <button type="button" class="btn btn-danger remove-btn" data-remove="${i}" title="Remove">
          <i class="bi bi-x"></i>
        </button>
      </div>`).join('');

    gallery.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._images.splice(parseInt(btn.dataset.remove), 1);
        this._renderGallery();
      });
    });
  },

  _renderVariants() {
    const list = document.getElementById('variants-list');
    if (!list) return;

    list.innerHTML = this._variants.map((variant, i) => `
      <tr class="border-bottom">
        <td class="py-2">
          <input type="text" class="form-control form-control-sm" placeholder="e.g., S, M, L, XL"
                 value="${escHtml(variant.size)}" data-variant-size="${i}">
        </td>
        <td class="py-2">
          <input type="number" class="form-control form-control-sm" placeholder="0" min="0"
                 value="${variant.stock}" data-variant-stock="${i}">
        </td>
        <td class="py-2 text-end">
          <button type="button" class="btn btn-sm btn-danger" data-remove-variant="${i}" title="Remove">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`).join('');

    // Attach input listeners
    list.querySelectorAll('[data-variant-size]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.variantSize);
        this._variants[idx].size = e.target.value.trim();
        this._updateVariantsPreview();
      });
      input.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.variantSize);
        this._variants[idx].size = e.target.value.trim();
        this._updateVariantsPreview();
      });
    });

    list.querySelectorAll('[data-variant-stock]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.variantStock);
        const stock = parseInt(e.target.value, 10) || 0;
        this._variants[idx].stock = Math.max(0, stock);
        e.target.value = this._variants[idx].stock;
        this._updateVariantsPreview();
      });
      input.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.variantStock);
        const stock = parseInt(e.target.value, 10) || 0;
        this._variants[idx].stock = Math.max(0, stock);
        this._updateVariantsPreview();
      });
    });

    list.querySelectorAll('[data-remove-variant]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.removeVariant);
        this._variants.splice(idx, 1);
        this._renderVariants();
        this._updateVariantsPreview();
      });
    });

    this._updateVariantsPreview();
  },

  _updateVariantsPreview() {
    const preview = document.getElementById('variants-preview');
    if (!preview) return;

    const variants = this._variants
      .filter(v => v.size.trim() !== '')
      .map(v => ({ size: v.size, stock: v.stock }));

    const json = { variants };
    preview.textContent = JSON.stringify(json);
  },

  _addVariant() {
    this._variants.push({ size: '', stock: 0 });
    this._renderVariants();
  },

  _clearErrors() {
    document.querySelectorAll('[data-field], #metadata-error, #variants-error').forEach(el => {
      el.textContent = '';
      el.classList.add('d-none');
    });
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  },

  _showFieldErrors(fieldErrors) {
    for (const [field, errors] of Object.entries(fieldErrors)) {
      const errEl = document.querySelector(`[data-field="${field}"]`);
      if (errEl) {
        errEl.textContent = Array.isArray(errors) ? errors.join(', ') : errors;
        errEl.classList.remove('d-none');
      }
      const input = document.querySelector(`[name="${field}"], [name="${field}_display"]`);
      if (input) input.classList.add('is-invalid');
    }
  },

  async _submit() {
    this._clearErrors();

    const form    = document.getElementById('product-form');
    const saveBtn = document.getElementById('save-btn');

    const name        = form.querySelector('[name=name]').value.trim();
    const description = form.querySelector('[name=description]').value.trim();
    const priceRaw    = form.querySelector('[name=price_display]').value;
    const currency    = form.querySelector('[name=currency]').value;
    const stockInput  = document.getElementById('stock-input');
    const unlimited   = document.getElementById('unlimited-check').checked;
    const active      = document.getElementById('active-toggle').checked;
    const metaRaw     = document.getElementById('metadata-input').value.trim();

    // Validate price
    const price = parsePriceInput(priceRaw);
    if (!price || price < 1) {
      const el = document.querySelector('[data-field=price]');
      if (el) { el.textContent = 'Enter a valid price greater than 0'; el.classList.remove('d-none'); }
      return;
    }

    // Validate metadata JSON
    let metadata = {};
    if (metaRaw) {
      try {
        metadata = JSON.parse(metaRaw);
        if (typeof metadata !== 'object' || Array.isArray(metadata) || metadata === null) throw new Error();
      } catch {
        const el = document.getElementById('metadata-error');
        el.textContent = 'Must be a valid JSON object, e.g. { "sku": "WP-001" }';
        el.classList.remove('d-none');
        return;
      }
    }

    // Add variants to metadata
    const variants = this._variants
      .filter(v => v.size.trim() !== '')
      .map(v => ({ size: v.size, stock: v.stock }));

    if (variants.length > 0) {
      metadata.variants = variants;
    }

    const stock = unlimited ? -1 : parseInt(stockInput.value, 10);

    const payload = {
      name,
      description,
      price,
      currency,
      stock,
      active,
      images:   this._images.map(i => i.url),
      metadata,
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

    try {
      if (this._isNew) {
        const created = await Api.createProduct(payload);
        Toast.success('Product created');
        // Navigate to the edit view for the new product
        Router.go(`/products/${created.id}/edit`);
      } else {
        await Api.updateProduct(this._id, payload);
        Toast.success('Changes saved');
      }
    } catch (err) {
      if (err.details?.fieldErrors) {
        this._showFieldErrors(err.details.fieldErrors);
      } else {
        Toast.error(err.message);
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Product' : 'Save Changes'}`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Orders List
// ═══════════════════════════════════════════════════════════════
const OrdersListView = {
  _offset:          0,
  _limit:           25,
  _statusFilter:    '',
  _fulfillFilter:   '',

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
          <div>
            <h1 class="fw-black mb-0" style="font-size:1.4rem;letter-spacing:-0.01em">Orders</h1>
            <p class="mb-0 mt-1" style="font-size:0.75rem;color:var(--text-muted)">Manage and fulfill customer orders</p>
          </div>
        </div>

        <!-- Quick-filter pills -->
        <div class="d-flex flex-wrap gap-2 mb-3" id="quick-filters">
          <button class="btn btn-sm btn-primary quick-filter active" data-status="" data-fulfill="">All Orders</button>
          <button class="btn btn-sm btn-outline-success quick-filter" data-status="paid" data-fulfill="unfulfilled">
            <i class="bi bi-inbox me-1"></i>New (paid, unshipped)
          </button>
          <button class="btn btn-sm btn-outline-warning quick-filter" data-status="" data-fulfill="processing">
            <i class="bi bi-box-seam me-1"></i>Processing
          </button>
          <button class="btn btn-sm btn-outline-info quick-filter" data-status="" data-fulfill="shipped">
            <i class="bi bi-truck me-1"></i>Shipped
          </button>
          <button class="btn btn-sm btn-outline-secondary quick-filter" data-status="cancelled" data-fulfill="">
            <i class="bi bi-x-circle me-1"></i>Cancelled
          </button>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="d-flex flex-wrap gap-2">
              <select class="form-select form-select-sm" id="status-filter" style="width:auto">
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select class="form-select form-select-sm" id="fulfillment-filter" style="width:auto">
                <option value="">All Fulfillment</option>
                <option value="unfulfilled">Unfulfilled</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            <span class="text-secondary small" id="orders-count"></span>
          </div>

          <div class="table-responsive">
            <table class="table table-dark table-hover align-middle mb-0 orders-table">
              <thead>
                <tr>
                  <th class="ps-3">Order</th>
                  <th>Customer</th>
                  <th class="d-none d-md-table-cell">Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Fulfillment</th>
                  <th class="d-none d-md-table-cell">Date</th>
                  <th class="pe-3"></th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                <tr>
                  <td colspan="8" class="text-center py-5">
                    <div class="spinner-border text-success" role="status">
                      <span class="visually-hidden">Loading…</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card-footer d-flex justify-content-between align-items-center" id="orders-pagination">
            <button class="btn btn-sm btn-outline-secondary" id="orders-prev-btn" disabled>
              <i class="bi bi-chevron-left me-1"></i>Previous
            </button>
            <span class="text-secondary small" id="orders-page-info"></span>
            <button class="btn btn-sm btn-outline-secondary" id="orders-next-btn" disabled>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async init() {
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

    document.getElementById('quick-filters').addEventListener('click', e => {
      const btn = e.target.closest('.quick-filter');
      if (!btn) return;
      document.querySelectorAll('.quick-filter').forEach(b => {
        b.classList.remove('active');
        b.className = b.className.replace('btn-primary', 'btn-outline-' + (b.dataset.status === 'cancelled' ? 'secondary' : b.dataset.fulfill === 'processing' ? 'warning' : b.dataset.fulfill === 'shipped' ? 'info' : 'success'));
      });
      btn.className = btn.className.replace(/btn-outline-\w+/, 'btn-primary');
      btn.classList.add('active');

      this._statusFilter  = btn.dataset.status;
      this._fulfillFilter = btn.dataset.fulfill;
      this._offset = 0;

      document.getElementById('status-filter').value      = this._statusFilter;
      document.getElementById('fulfillment-filter').value = this._fulfillFilter;
      this._load();
    });

    document.getElementById('status-filter').addEventListener('change', e => {
      this._statusFilter = e.target.value;
      this._offset = 0;
      this._load();
    });
    document.getElementById('fulfillment-filter').addEventListener('change', e => {
      this._fulfillFilter = e.target.value;
      this._offset = 0;
      this._load();
    });

    document.getElementById('orders-prev-btn').addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - this._limit);
      this._load();
    });
    document.getElementById('orders-next-btn').addEventListener('click', () => {
      this._offset += this._limit;
      this._load();
    });

    document.getElementById('orders-tbody').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn?.dataset.action === 'view') Router.go(`/orders/${btn.dataset.id}`);
    });

    await this._load();
  },

  async _load() {
    const tbody = document.getElementById('orders-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-5">
          <div class="spinner-border text-success" role="status"></div>
        </td>
      </tr>`;

    try {
      const orders = await Api.getOrders({
        limit:              this._limit,
        offset:             this._offset,
        status:             this._statusFilter || undefined,
        fulfillment_status: this._fulfillFilter || undefined,
      });
      this._renderRows(orders);
      this._updatePagination(orders.length);
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-4 text-danger">
            <i class="bi bi-exclamation-circle me-2"></i>${escHtml(err.message)}
          </td>
        </tr>`;
    }
  },

  _renderRows(orders) {
    const tbody   = document.getElementById('orders-tbody');
    const countEl = document.getElementById('orders-count');
    countEl.textContent = `${orders.length} order${orders.length !== 1 ? 's' : ''}`;

    if (orders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-5 text-secondary">
            <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>
            No orders found
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td class="ps-3">
          <div class="fw-semibold font-monospace small">#${o.id.slice(0, 8).toUpperCase()}</div>
          ${o.tracking_number
            ? `<div class="text-secondary" style="font-size:0.7rem"><i class="bi bi-truck me-1"></i>${escHtml(o.tracking_number)}</div>`
            : ''}
        </td>
        <td>
          <div class="fw-semibold small">${escHtml(o.customer_name ?? '—')}</div>
          <div class="text-secondary" style="font-size:0.75rem">${escHtml(o.customer_email ?? '')}</div>
        </td>
        <td class="text-secondary small d-none d-md-table-cell">
          ${(o.items?.length ?? 0)} item${(o.items?.length ?? 0) !== 1 ? 's' : ''}
        </td>
        <td class="fw-semibold">${formatPrice(o.amount_total, o.currency)}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${fulfillmentBadge(o.fulfillment_status)}</td>
        <td class="text-secondary small d-none d-md-table-cell">${formatDate(o.created_at)}</td>
        <td class="pe-3">
          <button class="btn btn-sm btn-outline-secondary" data-action="view" data-id="${escHtml(o.id)}">
            <i class="bi bi-eye me-1"></i>View
          </button>
        </td>
      </tr>`).join('');
  },

  _updatePagination(count) {
    const prev = document.getElementById('orders-prev-btn');
    const next = document.getElementById('orders-next-btn');
    const info = document.getElementById('orders-page-info');
    prev.disabled = this._offset === 0;
    next.disabled = count < this._limit;
    info.textContent = count > 0 ? `${this._offset + 1}–${this._offset + count}` : '';
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Order Detail
// ═══════════════════════════════════════════════════════════════
const OrderDetailView = {
  _id:    null,
  _order: null,

  render(id) {
    this._id    = id;
    this._order = null;
    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:960px">
        <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
          <a href="#/orders" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-arrow-left me-1"></i>Orders
          </a>
          <h1 class="fw-black mb-0" id="order-title" style="font-size:1.3rem;letter-spacing:-0.01em">
            <span style="color:var(--text-muted)">Loading…</span>
          </h1>
        </div>
        <div id="order-loader" class="page-loader">
          <div class="spinner-border text-success"></div>
        </div>
        <div id="order-content" class="d-none"></div>
      </div>`;
  },

  async init(id) {
    this._id = id;
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());
    await this._load();
  },

  async _load() {
    try {
      this._order = await Api.getOrder(this._id);
      this._renderContent();
    } catch (err) {
      document.getElementById('order-loader').innerHTML =
        `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Failed to load order: ${escHtml(err.message)}</div>`;
    }
  },

  _renderContent() {
    const o = this._order;
    document.getElementById('order-title').innerHTML =
      `Order <span class="font-monospace">#${o.id.slice(0, 8).toUpperCase()}</span>
       <span class="ms-2">${statusBadge(o.status)}</span>
       <span class="ms-1">${fulfillmentBadge(o.fulfillment_status)}</span>`;

    document.getElementById('order-loader').classList.add('d-none');
    const content = document.getElementById('order-content');
    content.classList.remove('d-none');
    content.innerHTML = this._buildHtml(o);
    this._bindEvents();
  },

  _buildHtml(o) {
    return `
      <div class="row g-4">

        <!-- ── Left column ─────────────────────────────────── -->
        <div class="col-lg-7">

          <!-- Customer & Shipping -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between align-items-center">
              Customer &amp; Shipping
              <button class="btn btn-sm btn-outline-secondary" id="edit-addr-btn">
                <i class="bi bi-pencil me-1"></i>Edit
              </button>
            </div>
            <!-- Display mode -->
            <div class="card-body" id="addr-display">
              ${this._addrDisplay(o)}
            </div>
            <!-- Edit mode (hidden) -->
            <div class="card-body d-none" id="addr-edit">
              ${this._addrForm(o)}
            </div>
          </div>

          <!-- Fulfillment actions -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Fulfillment
            </div>
            <div class="card-body">

              <!-- Quick action buttons -->
              <div class="mb-3">
                <div class="text-secondary small mb-2 fw-semibold">Quick Actions</div>
                <div class="d-flex flex-wrap gap-2" id="quick-actions">
                  ${this._quickActions(o)}
                </div>
              </div>

              <hr class="border-secondary">

              <!-- Existing tracking info (read-only banner) -->
              ${o.tracking_number ? `
              <div class="alert alert-secondary py-2 mb-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div class="small">
                  <i class="bi bi-truck me-2"></i>
                  <strong>${escHtml(o.shipping_carrier ?? '')}</strong>
                  ${o.shipping_service ? `<span class="text-secondary ms-1">${escHtml(o.shipping_service)}</span>` : ''}
                  <span class="ms-2 font-monospace">${escHtml(o.tracking_number)}</span>
                </div>
                ${o.label_url
                  ? `<a href="${escHtml(o.label_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary">
                       <i class="bi bi-printer me-1"></i>Print Label
                     </a>`
                  : ''}
              </div>` : ''}

              <!-- Manual tracking form -->
              <div class="text-secondary small mb-2 fw-semibold">Tracking Information</div>
              <form id="tracking-form">
                <div class="row g-2">
                  <div class="col-sm-6">
                    <label class="form-label small mb-1">Carrier</label>
                    <select class="form-select form-select-sm" name="shipping_carrier">
                      <option value="">— Select —</option>
                      ${['USPS','UPS','FedEx','DHL'].map(c =>
                        `<option value="${c}" ${o.shipping_carrier === c ? 'selected' : ''}>${c}</option>`
                      ).join('')}
                    </select>
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label small mb-1">Service</label>
                    <input type="text" class="form-control form-control-sm" name="shipping_service"
                           value="${escHtml(o.shipping_service ?? '')}" placeholder="e.g. Priority Mail">
                  </div>
                  <div class="col-12">
                    <label class="form-label small mb-1">Tracking Number</label>
                    <input type="text" class="form-control form-control-sm" name="tracking_number"
                           value="${escHtml(o.tracking_number ?? '')}" placeholder="Enter tracking number">
                  </div>
                  <div class="col-12">
                    <label class="form-label small mb-1">Label URL <span class="text-secondary">(optional)</span></label>
                    <input type="url" class="form-control form-control-sm" name="label_url"
                           value="${escHtml(o.label_url ?? '')}" placeholder="https://...">
                  </div>
                </div>
                <button type="submit" class="btn btn-sm btn-primary mt-3" id="save-tracking-btn">
                  <i class="bi bi-check-lg me-1"></i>Save Tracking
                </button>
              </form>

              <hr class="border-secondary">

              <!-- Notes -->
              <div class="text-secondary small mb-2 fw-semibold">Internal Notes <span class="fw-normal">(not shown to customer)</span></div>
              <form id="notes-form">
                <textarea class="form-control form-control-sm" name="notes" rows="3"
                          placeholder="Add packing notes, customer requests, etc.…">${escHtml(o.notes ?? '')}</textarea>
                <button type="submit" class="btn btn-sm btn-outline-secondary mt-2">
                  <i class="bi bi-save me-1"></i>Save Notes
                </button>
              </form>
            </div>
          </div>

        </div>

        <!-- ── Right column ────────────────────────────────── -->
        <div class="col-lg-5">

          <!-- Line items -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Order Items
            </div>
            ${(o.items ?? []).length === 0
              ? '<div class="card-body text-secondary small">No items</div>'
              : `<ul class="list-group list-group-flush">
                  ${(o.items ?? []).map(item => `
                    <li class="list-group-item bg-transparent border-secondary px-3 py-2">
                      <div class="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <div class="fw-semibold small">${escHtml(item.product_name ?? '—')}</div>
                          <div class="text-secondary" style="font-size:0.75rem">
                            ${item.quantity} × ${formatPrice(item.price, item.currency)}
                          </div>
                        </div>
                        <div class="fw-semibold small text-nowrap">
                          ${formatPrice(item.price * item.quantity, item.currency)}
                        </div>
                      </div>
                    </li>`).join('')}
                  <li class="list-group-item bg-transparent border-secondary px-3 py-2">
                    <div class="d-flex justify-content-between fw-bold">
                      <span>Total</span>
                      <span class="text-success">${formatPrice(o.amount_total, o.currency)}</span>
                    </div>
                  </li>
                </ul>`}
          </div>

          <!-- Order metadata -->
          <div class="card">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Order Details
            </div>
            <div class="card-body small">
              <dl class="row g-1 mb-0">
                <dt class="col-5 text-secondary">Order ID</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem" title="${escHtml(o.id)}">${escHtml(o.id)}</dd>

                <dt class="col-5 text-secondary">Date</dt>
                <dd class="col-7">${formatDate(o.created_at)}</dd>

                <dt class="col-5 text-secondary">Customer</dt>
                <dd class="col-7">${escHtml(o.customer_email ?? '—')}</dd>

                <dt class="col-5 text-secondary">Stripe Session</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem"
                    title="${escHtml(o.stripe_session_id ?? '')}">
                  ${o.stripe_session_id ? escHtml(o.stripe_session_id) : '—'}
                </dd>

                <dt class="col-5 text-secondary">Payment Intent</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem"
                    title="${escHtml(o.stripe_payment_intent_id ?? '')}">
                  ${o.stripe_payment_intent_id ? escHtml(o.stripe_payment_intent_id) : '—'}
                </dd>
              </dl>
            </div>
          </div>

        </div>
      </div>`;
  },

  _addrDisplay(o) {
    const addrLines = [
      o.shipping_address_line1,
      o.shipping_address_line2,
      [o.shipping_city, o.shipping_state, o.shipping_postal_code].filter(Boolean).join(', '),
      o.shipping_country,
    ].filter(Boolean);

    return `
      <div class="row g-3 small">
        <div class="col-sm-6">
          <div class="text-secondary mb-1">Name</div>
          <div class="fw-semibold">${escHtml(o.customer_name ?? '—')}</div>
        </div>
        <div class="col-sm-6">
          <div class="text-secondary mb-1">Email</div>
          <div>${o.customer_email
            ? `<a href="mailto:${escHtml(o.customer_email)}" class="text-decoration-none">${escHtml(o.customer_email)}</a>`
            : '—'}</div>
        </div>
        <div class="col-12">
          <div class="text-secondary mb-1">Shipping Address</div>
          ${addrLines.length
            ? `<div>${addrLines.map(l => escHtml(l)).join('<br>')}</div>`
            : '<div class="text-secondary">No address on file</div>'}
          ${o.shipping_phone
            ? `<div class="text-secondary mt-1"><i class="bi bi-telephone me-1"></i>${escHtml(o.shipping_phone)}</div>`
            : ''}
        </div>
      </div>`;
  },

  _addrForm(o) {
    const f = (name, label, value, type = 'text') => `
      <div>
        <label class="form-label small mb-1">${label}</label>
        <input type="${type}" class="form-control form-control-sm" name="${name}" value="${escHtml(value ?? '')}">
      </div>`;
    return `
      <form id="addr-form">
        <div class="row g-2">
          <div class="col-sm-6">${f('customer_name',        'Full Name',             o.customer_name)}</div>
          <div class="col-sm-6">${f('customer_email',       'Email',                 o.customer_email, 'email')}</div>
          <div class="col-12">${f('shipping_address_line1', 'Address Line 1',        o.shipping_address_line1)}</div>
          <div class="col-12">${f('shipping_address_line2', 'Address Line 2 (opt.)', o.shipping_address_line2)}</div>
          <div class="col-5">${f('shipping_city',           'City',                  o.shipping_city)}</div>
          <div class="col-3">${f('shipping_state',          'State',                 o.shipping_state)}</div>
          <div class="col-4">${f('shipping_postal_code',    'ZIP',                   o.shipping_postal_code)}</div>
          <div class="col-sm-6">${f('shipping_country',    'Country (2-char)',       o.shipping_country)}</div>
          <div class="col-sm-6">${f('shipping_phone',      'Phone',                  o.shipping_phone)}</div>
        </div>
        <div class="d-flex gap-2 mt-3">
          <button type="submit" class="btn btn-sm btn-primary">
            <i class="bi bi-check-lg me-1"></i>Save Address
          </button>
          <button type="button" class="btn btn-sm btn-secondary" id="cancel-addr-btn">Cancel</button>
        </div>
      </form>`;
  },

  _quickActions(o) {
    const { status, fulfillment_status: fs } = o;
    const btns = [];

    if (status === 'paid' && (fs === 'unfulfilled' || !fs)) {
      btns.push(`<button class="btn btn-sm btn-outline-warning" data-update='{"fulfillment_status":"processing"}'>
        <i class="bi bi-box-seam me-1"></i>Start Processing
      </button>`);
    }
    if (fs === 'processing') {
      btns.push(`<button class="btn btn-sm btn-outline-info" data-update='{"fulfillment_status":"shipped","status":"fulfilled"}'>
        <i class="bi bi-truck me-1"></i>Mark Shipped
      </button>`);
    }
    if (fs === 'shipped') {
      btns.push(`<button class="btn btn-sm btn-outline-success" data-update='{"fulfillment_status":"delivered","status":"fulfilled"}'>
        <i class="bi bi-check2-circle me-1"></i>Mark Delivered
      </button>`);
    }
    if (status !== 'cancelled') {
      btns.push(`<button class="btn btn-sm btn-outline-danger" data-update='{"status":"cancelled"}' data-confirm="Cancel this order?">
        <i class="bi bi-x-circle me-1"></i>Cancel Order
      </button>`);
    }
    if (btns.length === 0) {
      return `<span class="text-secondary small">
        Order is ${status === 'cancelled' ? 'cancelled' : 'complete — no further actions needed'}.
      </span>`;
    }
    return btns.join('');
  },

  _bindEvents() {
    // Logout already bound by init
    const editBtn = document.getElementById('edit-addr-btn');
    editBtn.addEventListener('click', () => {
      document.getElementById('addr-display').classList.add('d-none');
      document.getElementById('addr-edit').classList.remove('d-none');
      editBtn.classList.add('d-none');
    });

    // Cancel address edit
    document.getElementById('order-content').addEventListener('click', e => {
      if (e.target.closest('#cancel-addr-btn')) {
        document.getElementById('addr-display').classList.remove('d-none');
        document.getElementById('addr-edit').classList.add('d-none');
        document.getElementById('edit-addr-btn').classList.remove('d-none');
      }
    });

    // Save address
    document.getElementById('addr-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn  = e.target.querySelector('[type=submit]');
      const data = Object.fromEntries(new FormData(e.target).entries());
      // Blank string → null
      Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
      btn.disabled = true;
      await this._save(data, 'Address updated');
    });

    // Tracking form
    document.getElementById('tracking-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn  = document.getElementById('save-tracking-btn');
      const data = Object.fromEntries(new FormData(e.target).entries());
      Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
      btn.disabled = true;
      await this._save(data, 'Tracking saved');
    });

    // Notes form
    document.getElementById('notes-form').addEventListener('submit', async e => {
      e.preventDefault();
      const notes = e.target.querySelector('[name=notes]').value;
      const btn   = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      await this._save({ notes }, 'Notes saved');
    });

    // Quick action buttons
    document.getElementById('quick-actions').addEventListener('click', async e => {
      const btn = e.target.closest('[data-update]');
      if (!btn) return;
      const payload  = JSON.parse(btn.dataset.update);
      const confirmMsg = btn.dataset.confirm;
      if (confirmMsg) {
        const ok = await confirmModal('Confirm', confirmMsg, 'Yes, proceed', 'btn-danger');
        if (!ok) return;
      }
      btn.disabled = true;
      await this._save(payload, 'Order updated');
    });
  },

  async _save(data, successMsg) {
    try {
      this._order = await Api.updateOrder(this._id, data);
      Toast.success(successMsg);
      this._renderContent();
    } catch (err) {
      Toast.error(err.message);
      // Re-enable any disabled buttons
      document.querySelectorAll('#order-content button[disabled]').forEach(b => { b.disabled = false; });
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// Discount Helpers
// ═══════════════════════════════════════════════════════════════

function discountValueDisplay(type, value, currency = 'usd') {
  if (type === 'percentage')   return `${value}% off`;
  if (type === 'free_shipping') return 'Free shipping';
  return `${formatPrice(value, currency)} off`;
}

function discountTypeBadge(type) {
  const map = {
    percentage:   'text-bg-info',
    fixed_amount: 'text-bg-primary',
    free_shipping:'text-bg-success',
  };
  const label = { percentage: 'Percentage', fixed_amount: 'Fixed Amount', free_shipping: 'Free Shipping' };
  return `<span class="badge ${map[type] ?? 'text-bg-secondary'}">${label[type] ?? type}</span>`;
}

// ═══════════════════════════════════════════════════════════════
// View: Discounts List
// ═══════════════════════════════════════════════════════════════
const DiscountsListView = {
  _filter: '',

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
          <div>
            <h1 class="fw-black mb-0" style="font-size:1.4rem;letter-spacing:-0.01em">Discounts</h1>
            <p class="mb-0 mt-1" style="font-size:0.75rem;color:var(--text-muted)">Promo codes, sales, and automatic promotions</p>
          </div>
          <a href="#/discounts/new" class="btn btn-primary">
            <i class="bi bi-plus-lg me-1"></i>New Discount
          </a>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group btn-group-sm" id="discount-filter-group">
              <input type="radio" class="btn-check" name="disc-filter" id="df-all"      value=""      checked>
              <label class="btn btn-outline-secondary" for="df-all">All</label>
              <input type="radio" class="btn-check" name="disc-filter" id="df-active"   value="true">
              <label class="btn btn-outline-secondary" for="df-active">Active</label>
              <input type="radio" class="btn-check" name="disc-filter" id="df-inactive" value="false">
              <label class="btn btn-outline-secondary" for="df-inactive">Inactive</label>
            </div>
            <span class="text-secondary small" id="discount-count"></span>
          </div>

          <div class="table-responsive">
            <table class="table table-dark table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th class="ps-3">Code / Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Usage</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th class="pe-3">Actions</th>
                </tr>
              </thead>
              <tbody id="discounts-tbody">
                <tr>
                  <td colspan="7" class="text-center py-5">
                    <div class="spinner-border text-success" role="status"></div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  },

  async init() {
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

    document.getElementById('discount-filter-group').addEventListener('change', e => {
      this._filter = e.target.value;
      this._load();
    });

    document.getElementById('discounts-tbody').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, name, active } = btn.dataset;

      if (action === 'edit') { Router.go(`/discounts/${id}/edit`); return; }

      if (action === 'toggle') {
        const nowActive = active === 'true';
        btn.disabled = true;
        try {
          await Api.updateDiscount(id, { active: !nowActive });
          Toast.success(`Discount ${!nowActive ? 'activated' : 'deactivated'}`);
          this._load();
        } catch (err) {
          Toast.error(err.message);
          btn.disabled = false;
        }
        return;
      }

      if (action === 'delete') {
        const ok = await confirmModal(
          'Delete discount',
          `<p class="mb-0">Permanently delete <strong>${escHtml(name)}</strong>?</p>`,
          'Delete', 'btn-danger'
        );
        if (!ok) return;
        try {
          await Api.deleteDiscount(id);
          Toast.success('Discount deleted');
          this._load();
        } catch (err) {
          Toast.error(err.message);
        }
      }
    });

    await this._load();
  },

  async _load() {
    const tbody = document.getElementById('discounts-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-5">
          <div class="spinner-border text-success" role="status"></div>
        </td>
      </tr>`;

    try {
      const params = this._filter ? { active: this._filter } : {};
      const discounts = await Api.getDiscounts(params);
      const countEl  = document.getElementById('discount-count');
      countEl.textContent = `${discounts.length} discount${discounts.length !== 1 ? 's' : ''}`;

      if (discounts.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-5 text-secondary">
              <i class="bi bi-tag fs-2 d-block mb-2 opacity-50"></i>
              No discounts found
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = discounts.map(d => `
        <tr>
          <td class="ps-3">
            <div class="fw-semibold">${d.code ? escHtml(d.code) : '<span class="text-secondary fst-italic">Automatic</span>'}</div>
            <div class="text-secondary small">${escHtml(d.name)}</div>
          </td>
          <td>${discountTypeBadge(d.type)}</td>
          <td class="fw-semibold">${discountValueDisplay(d.type, d.value)}</td>
          <td class="text-secondary small">
            ${d.usage_limit !== null
              ? `${d.usage_count} / ${d.usage_limit}`
              : `${d.usage_count} <span class="opacity-50">/ ∞</span>`}
          </td>
          <td class="text-secondary small">${d.ends_at ? formatDate(d.ends_at) : '—'}</td>
          <td>${activeBadge(d.active)}</td>
          <td class="pe-3">
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" title="Edit"
                      data-action="edit" data-id="${escHtml(d.id)}">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm ${d.active ? 'btn-outline-warning' : 'btn-outline-success'}"
                      title="${d.active ? 'Deactivate' : 'Activate'}"
                      data-action="toggle" data-id="${escHtml(d.id)}" data-active="${d.active}">
                <i class="bi bi-${d.active ? 'eye-slash' : 'eye'}"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" title="Delete"
                      data-action="delete" data-id="${escHtml(d.id)}" data-name="${escHtml(d.name)}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-4 text-danger">
            <i class="bi bi-exclamation-circle me-2"></i>${escHtml(err.message)}
          </td>
        </tr>`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Discount Form (create + edit)
// ═══════════════════════════════════════════════════════════════
const DiscountFormView = {
  _id:    null,
  _isNew: false,

  render(id) {
    this._id    = id ?? null;
    this._isNew = !id;
    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:640px">

        <div class="d-flex align-items-center gap-3 mb-4">
          <a href="#/discounts" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-arrow-left me-1"></i>Back
          </a>
          <h1 class="fw-black mb-0" id="form-title" style="font-size:1.3rem;letter-spacing:-0.01em">
            ${this._isNew ? 'New Discount' : '<span style="color:var(--text-muted)">Loading…</span>'}
          </h1>
        </div>

        <div id="form-loader" class="page-loader ${!this._isNew ? '' : 'd-none'}">
          <div class="spinner-border text-success"></div>
        </div>

        <form id="discount-form" novalidate class="${this._isNew ? '' : 'd-none'}">

          <!-- Core details -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">Discount Details</div>
            <div class="card-body">

              <div class="mb-3">
                <label class="form-label small fw-semibold">Name <span class="text-danger">*</span></label>
                <input type="text" class="form-control" name="name" maxlength="255" required
                       placeholder="e.g., Summer Sale 20%">
                <div class="invalid-feedback" data-field="name"></div>
                <div class="form-text">Internal name shown in the admin dashboard.</div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-semibold">Promo Code <span class="text-secondary fw-normal">(leave blank for automatic)</span></label>
                <input type="text" class="form-control text-uppercase font-monospace" name="code"
                       maxlength="50" placeholder="e.g., SUMMER20" autocomplete="off"
                       style="text-transform:uppercase">
                <div class="form-text">Leave blank to create an automatic discount (no code needed at checkout). Codes are case-insensitive.</div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-semibold">Description <span class="text-secondary fw-normal">(optional)</span></label>
                <textarea class="form-control" name="description" rows="2" maxlength="1000"
                          placeholder="Shown to the customer if applicable"></textarea>
              </div>

            </div>
          </div>

          <!-- Discount type & value -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">Discount Type &amp; Value</div>
            <div class="card-body">

              <div class="mb-3">
                <label class="form-label small fw-semibold">Type <span class="text-danger">*</span></label>
                <select class="form-select" name="type" id="discount-type">
                  <option value="percentage">Percentage off (%)</option>
                  <option value="fixed_amount">Fixed amount off ($)</option>
                  <option value="free_shipping">Free shipping</option>
                </select>
              </div>

              <div id="value-row" class="mb-3">
                <label class="form-label small fw-semibold" id="value-label">Percentage <span class="text-danger">*</span></label>
                <div class="input-group" style="max-width:200px">
                  <input type="number" class="form-control" name="value" id="value-input"
                         min="1" max="100" step="1" placeholder="e.g., 20" required>
                  <span class="input-group-text" id="value-suffix">%</span>
                </div>
                <div class="form-text" id="value-hint">Enter a whole number from 1 to 100.</div>
                <div class="invalid-feedback d-block d-none" data-field="value"></div>
              </div>

            </div>
          </div>

          <!-- Conditions -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">Conditions</div>
            <div class="card-body">

              <div class="mb-3">
                <label class="form-label small fw-semibold">Minimum Order Amount</label>
                <div class="input-group" style="max-width:200px">
                  <span class="input-group-text">$</span>
                  <input type="number" class="form-control" name="minimum_order_amount"
                         min="0" step="0.01" placeholder="0.00" value="0">
                </div>
                <div class="form-text">Leave at 0 for no minimum.</div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-semibold">Usage Limit <span class="text-secondary fw-normal">(optional)</span></label>
                <div class="d-flex align-items-center gap-3">
                  <input type="number" class="form-control" name="usage_limit" id="usage-limit-input"
                         min="1" step="1" placeholder="e.g., 100" style="max-width:140px" disabled>
                  <div class="form-check mb-0">
                    <input class="form-check-input" type="checkbox" id="unlimited-uses" checked>
                    <label class="form-check-label small text-secondary" for="unlimited-uses">Unlimited</label>
                  </div>
                </div>
                <div class="form-text">Total number of times this discount can be used across all customers.</div>
              </div>

            </div>
          </div>

          <!-- Schedule -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">Schedule <span class="fw-normal">(optional)</span></div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-sm-6">
                  <label class="form-label small fw-semibold">Start Date</label>
                  <input type="datetime-local" class="form-control" name="starts_at">
                  <div class="form-text">Leave blank to start immediately.</div>
                </div>
                <div class="col-sm-6">
                  <label class="form-label small fw-semibold">End Date</label>
                  <input type="datetime-local" class="form-control" name="ends_at">
                  <div class="form-text">Leave blank for no expiry.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Status -->
          <div class="card mb-4">
            <div class="card-body">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="discount-active" name="active" checked>
                <label class="form-check-label fw-semibold" for="discount-active">Active</label>
              </div>
              <div class="form-text">Inactive discounts cannot be used or applied.</div>
            </div>
          </div>

          <div class="d-flex justify-content-end gap-2">
            <a href="#/discounts" class="btn btn-secondary">Cancel</a>
            <button type="submit" class="btn btn-primary px-4 fw-semibold" id="save-btn">
              <i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Discount' : 'Save Changes'}
            </button>
          </div>

        </form>
      </div>`;
  },

  async init(id) {
    this._id    = id ?? null;
    this._isNew = !id;

    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

    // Type → value field label/suffix/hint update
    const typeSelect  = document.getElementById('discount-type');
    const valueRow    = document.getElementById('value-row');
    const valueInput  = document.getElementById('value-input');
    const valueLabel  = document.getElementById('value-label');
    const valueSuffix = document.getElementById('value-suffix');
    const valueHint   = document.getElementById('value-hint');

    const updateTypeUI = () => {
      const type = typeSelect.value;
      if (type === 'free_shipping') {
        valueRow.classList.add('d-none');
        valueInput.required = false;
      } else {
        valueRow.classList.remove('d-none');
        valueInput.required = true;
        if (type === 'percentage') {
          valueLabel.innerHTML  = 'Percentage <span class="text-danger">*</span>';
          valueSuffix.textContent = '%';
          valueHint.textContent   = 'Enter a whole number from 1 to 100.';
          valueInput.min = '1'; valueInput.max = '100'; valueInput.step = '1';
        } else {
          valueLabel.innerHTML  = 'Amount Off <span class="text-danger">*</span>';
          valueSuffix.textContent = 'USD';
          valueHint.textContent   = 'Enter the amount to deduct from the order total.';
          valueInput.min = '0.01'; valueInput.max = ''; valueInput.step = '0.01';
        }
      }
    };
    typeSelect.addEventListener('change', updateTypeUI);
    updateTypeUI();

    // Usage limit toggle
    const unlimitedCheck  = document.getElementById('unlimited-uses');
    const usageLimitInput = document.getElementById('usage-limit-input');
    unlimitedCheck.addEventListener('change', () => {
      usageLimitInput.disabled = unlimitedCheck.checked;
      if (!unlimitedCheck.checked) usageLimitInput.focus();
    });

    // Uppercase code input
    document.querySelector('[name=code]').addEventListener('input', e => {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(pos, pos);
    });

    if (!this._isNew) {
      try {
        const d = await Api.getDiscount(id);
        this._fillForm(d);
        document.getElementById('form-loader').classList.add('d-none');
        document.getElementById('discount-form').classList.remove('d-none');
        document.getElementById('form-title').textContent = d.name;
      } catch (err) {
        document.getElementById('form-loader').innerHTML =
          `<div class="alert alert-danger">Failed to load discount: ${escHtml(err.message)}</div>`;
        return;
      }
    }

    document.getElementById('discount-form').addEventListener('submit', async e => {
      e.preventDefault();
      await this._submit();
    });
  },

  _fillForm(d) {
    const form = document.getElementById('discount-form');
    form.querySelector('[name=name]').value        = d.name ?? '';
    form.querySelector('[name=code]').value        = d.code ?? '';
    form.querySelector('[name=description]').value = d.description ?? '';
    form.querySelector('[name=type]').value        = d.type ?? 'percentage';

    // Trigger type UI update
    document.getElementById('discount-type').dispatchEvent(new Event('change'));

    const valInput = document.getElementById('value-input');
    if (d.type === 'percentage')  valInput.value = d.value;
    else if (d.type === 'fixed_amount') valInput.value = (d.value / 100).toFixed(2);

    const minInput = form.querySelector('[name=minimum_order_amount]');
    minInput.value = d.minimum_order_amount > 0 ? (d.minimum_order_amount / 100).toFixed(2) : '0';

    const unlimitedCheck  = document.getElementById('unlimited-uses');
    const usageLimitInput = document.getElementById('usage-limit-input');
    if (d.usage_limit !== null) {
      unlimitedCheck.checked    = false;
      usageLimitInput.disabled  = false;
      usageLimitInput.value     = d.usage_limit;
    } else {
      unlimitedCheck.checked   = true;
      usageLimitInput.disabled = true;
    }

    const toLocalDatetime = iso => {
      if (!iso) return '';
      return new Date(iso).toISOString().slice(0, 16);
    };
    form.querySelector('[name=starts_at]').value = toLocalDatetime(d.starts_at);
    form.querySelector('[name=ends_at]').value   = toLocalDatetime(d.ends_at);

    document.getElementById('discount-active').checked = d.active !== false;

    const btn = document.getElementById('save-btn');
    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Save Changes';
  },

  async _submit() {
    const form    = document.getElementById('discount-form');
    const saveBtn = document.getElementById('save-btn');

    const name        = form.querySelector('[name=name]').value.trim();
    const code        = form.querySelector('[name=code]').value.trim().toUpperCase() || null;
    const description = form.querySelector('[name=description]').value.trim();
    const type        = form.querySelector('[name=type]').value;
    const active      = document.getElementById('discount-active').checked;

    if (!name) {
      const el = form.querySelector('[data-field=name]');
      if (el) { el.textContent = 'Name is required'; el.classList.remove('d-none'); }
      return;
    }

    // Parse value
    let value = 0;
    if (type !== 'free_shipping') {
      const raw = parseFloat(document.getElementById('value-input').value);
      if (isNaN(raw) || raw <= 0) {
        const el = form.querySelector('[data-field=value]');
        if (el) { el.textContent = 'Enter a valid value greater than 0'; el.classList.remove('d-none'); }
        return;
      }
      value = type === 'percentage' ? Math.round(raw) : Math.round(raw * 100);
    }

    // Parse minimum order amount
    const minRaw = parseFloat(form.querySelector('[name=minimum_order_amount]').value);
    const minimum_order_amount = isNaN(minRaw) || minRaw <= 0 ? 0 : Math.round(minRaw * 100);

    // Parse usage limit
    const unlimitedCheck = document.getElementById('unlimited-uses');
    let usage_limit = null;
    if (!unlimitedCheck.checked) {
      const limitVal = parseInt(document.getElementById('usage-limit-input').value, 10);
      if (!isNaN(limitVal) && limitVal > 0) usage_limit = limitVal;
    }

    // Parse dates
    const toISO = s => {
      const v = form.querySelector(`[name=${s}]`).value;
      if (!v) return null;
      try { return new Date(v).toISOString(); } catch { return null; }
    };
    const starts_at = toISO('starts_at');
    const ends_at   = toISO('ends_at');

    const payload = {
      name, description, type, value, active,
      minimum_order_amount, usage_limit, starts_at, ends_at,
      ...(this._isNew ? { code } : {}),
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

    try {
      if (this._isNew) {
        await Api.createDiscount(payload);
        Toast.success('Discount created');
        Router.go('/discounts');
      } else {
        await Api.updateDiscount(this._id, payload);
        Toast.success('Changes saved');
      }
    } catch (err) {
      Toast.error(err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Discount' : 'Save Changes'}`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════
const Router = {
  go(path) { location.hash = `#${path}`; },

  init() {
    window.addEventListener('hashchange', () => this._route());
    this._route();
  },

  _route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const app  = document.getElementById('app');

    // Redirect root
    if (hash === '/') {
      this.go(Auth.isLoggedIn() ? '/products' : '/login');
      return;
    }

    // Auth guard
    if (hash !== '/login' && !Auth.isLoggedIn()) { this.go('/login'); return; }
    if (hash === '/login' && Auth.isLoggedIn())  { this.go('/products'); return; }

    if (hash === '/login') {
      app.innerHTML = LoginView.render();
      LoginView.init();
      return;
    }

    if (hash === '/products') {
      app.innerHTML = ProductsListView.render();
      ProductsListView.init();
      return;
    }

    if (hash === '/products/new') {
      app.innerHTML = ProductFormView.render(null);
      ProductFormView.init(null);
      return;
    }

    const editMatch = hash.match(/^\/products\/([^/]+)\/edit$/);
    if (editMatch) {
      app.innerHTML = ProductFormView.render(editMatch[1]);
      ProductFormView.init(editMatch[1]);
      return;
    }

    if (hash === '/orders') {
      app.innerHTML = OrdersListView.render();
      OrdersListView.init();
      return;
    }

    const orderMatch = hash.match(/^\/orders\/([^/]+)$/);
    if (orderMatch) {
      app.innerHTML = OrderDetailView.render(orderMatch[1]);
      OrderDetailView.init(orderMatch[1]);
      return;
    }

    if (hash === '/discounts') {
      app.innerHTML = DiscountsListView.render();
      DiscountsListView.init();
      return;
    }

    if (hash === '/discounts/new') {
      app.innerHTML = DiscountFormView.render(null);
      DiscountFormView.init(null);
      return;
    }

    const discountEditMatch = hash.match(/^\/discounts\/([^/]+)\/edit$/);
    if (discountEditMatch) {
      app.innerHTML = DiscountFormView.render(discountEditMatch[1]);
      DiscountFormView.init(discountEditMatch[1]);
      return;
    }

    app.innerHTML = `
      <div class="text-center py-5">
        <div style="font-size:3rem;margin-bottom:1rem">★</div>
        <h3 style="color:var(--text-muted)">404 — Page not found</h3>
        <a href="#/products" class="btn btn-primary mt-3">Go to Products</a>
      </div>`;
  },
};

// ═══════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════
// The shared SaaS dashboard has nothing to load server-side — the tenant's
// subdomain comes from the URL / sessionStorage / login form, and every other
// piece of state lives behind an authenticated API call. Config.load() is
// synchronous and never throws, so the boot path is just: discover tenant,
// hand off to the router.
document.addEventListener('DOMContentLoaded', () => {
  Config.load();
  Router.init();
});
