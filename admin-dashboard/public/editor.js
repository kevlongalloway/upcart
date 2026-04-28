'use strict';
/* =============================================================
   Upcart Store Editor — editor.js
   Shopify-style visual editor: left nav (pages + sections),
   centre live-iframe, right properties panel.

   Works entirely with the existing backend:
     GET  /admin/settings  — load current state
     PUT  /admin/settings  — persist (page_sections stored as JSON)

   Live preview is driven by postMessage to the storefront's
   theme.js bridge (type: "bst:preview").
   ============================================================= */

/* ── Theme presets (mirrors theme.js) ────────────────────────── */
const THEMES = [
  { id: 'base',     name: 'Base',     desc: 'System fonts, clean & modern',  bg: '#ffffff', text: '#111111', btn: '#111111' },
  { id: 'mono',     name: 'Mono',     desc: 'Editorial monospace, light',     bg: '#f5f5f5', text: '#1a1a1a', btn: '#1a1a1a' },
  { id: 'minimal',  name: 'Minimal',  desc: 'Pure white, Inter, corporate',   bg: '#ffffff', text: '#111111', btn: '#111111' },
  { id: 'boutique', name: 'Boutique', desc: 'Cream, serif, luxury fashion',   bg: '#faf7f2', text: '#2c1810', btn: '#2c1810' },
  { id: 'bold',     name: 'Bold',     desc: 'Dark, gold accent, streetwear',  bg: '#0a0a0a', text: '#f0f0f0', btn: '#f5c000' },
  { id: 'studio',   name: 'Studio',   desc: 'Warm, DM Serif, artisan',        bg: '#f5f0ea', text: '#2d2419', btn: '#c4603a' },
];

/* ── Section type definitions ────────────────────────────────── */
const SECTION_TYPES = {
  header: {
    name: 'Header',
    icon: 'bi-layout-wtf',
    fixed: true,       // cannot remove / reorder
    fields: [
      { key: 'store_name', type: 'text',  label: 'Store Name', placeholder: 'My Store',   maxlength: 100 },
      { key: 'logo_url',   type: 'image', label: 'Logo' },
    ],
  },
  hero: {
    name: 'Hero Banner',
    icon: 'bi-card-image',
    fields: [
      { key: 'hero_title',    type: 'text',     label: 'Headline',    placeholder: 'Your Store',                maxlength: 100 },
      { key: 'hero_subtitle', type: 'textarea', label: 'Subheadline', placeholder: 'Discover our collection',   maxlength: 200 },
      { key: 'hero_cta',      type: 'text',     label: 'Button text', placeholder: 'Shop Now',                  maxlength: 50  },
    ],
  },
  'product-grid': {
    name: 'Product Grid',
    icon: 'bi-grid-3x3-gap',
    fields: [],
  },
  'announcement-bar': {
    name: 'Announcement',
    icon: 'bi-megaphone',
    fields: [
      { key: 'announce_text',  type: 'text',  label: 'Message',    placeholder: 'Free shipping on orders over $50', maxlength: 200 },
      { key: 'announce_bg',    type: 'color', label: 'Background color' },
      { key: 'announce_color', type: 'color', label: 'Text color'       },
    ],
  },
  'text-block': {
    name: 'Text Block',
    icon: 'bi-text-paragraph',
    fields: [
      { key: 'text_heading', type: 'text',     label: 'Heading', placeholder: '',  maxlength: 100 },
      { key: 'text_body',    type: 'textarea', label: 'Body',    placeholder: '',  maxlength: 600 },
    ],
  },
  footer: {
    name: 'Footer',
    icon: 'bi-layout-bottom',
    fixed: true,
    fields: [
      { key: 'store_description', type: 'textarea', label: 'Tagline / description', placeholder: '', maxlength: 300 },
    ],
  },
};

/* Section types the merchant can add to a page */
const ADDABLE_TYPES = ['announcement-bar', 'hero', 'product-grid', 'text-block'];

/* ── Page definitions ────────────────────────────────────────── */
const PAGES = [
  { id: 'home',    name: 'Home',           icon: 'bi-house',    file: 'index.html'    },
  { id: 'catalog', name: 'Products',       icon: 'bi-grid',     file: 'products.html' },
  { id: 'cart',    name: 'Cart',           icon: 'bi-bag',      file: 'cart.html'     },
  { id: 'product', name: 'Product Detail', icon: 'bi-tag',      file: 'product.html'  },
];

/* Default section layout used when no saved config exists yet */
const DEFAULT_SECTIONS = {
  home:    [
    { id: 's_hdr1',  type: 'header',       visible: true, settings: {} },
    { id: 's_hero1', type: 'hero',         visible: true, settings: {} },
    { id: 's_pgrd1', type: 'product-grid', visible: true, settings: {} },
    { id: 's_ftr1',  type: 'footer',       visible: true, settings: {} },
  ],
  catalog: [
    { id: 's_hdr2',  type: 'header',       visible: true, settings: {} },
    { id: 's_pgrd2', type: 'product-grid', visible: true, settings: {} },
    { id: 's_ftr2',  type: 'footer',       visible: true, settings: {} },
  ],
  cart: [
    { id: 's_hdr3',  type: 'header',       visible: true, settings: {} },
    { id: 's_ftr3',  type: 'footer',       visible: true, settings: {} },
  ],
  product: [
    { id: 's_hdr4',  type: 'header',       visible: true, settings: {} },
    { id: 's_ftr4',  type: 'footer',       visible: true, settings: {} },
  ],
};

/* ── Application state ───────────────────────────────────────── */
const state = {
  settings: {
    theme: 'base', brand_primary: '', brand_accent: '',
    logo_url: '', store_name: '', store_description: '',
    hero_title: '', hero_subtitle: '', hero_cta: '',
  },
  pageSections:  deepClone(DEFAULT_SECTIONS),
  activePage:    'home',
  activeSection: null,   // null → show global theme panel
  dirty:         false,
  history:       [],
  historyIdx:    -1,
  storeUrl:      '',
  storeOrigin:   '*',
  _fileInput:    null,   // reused hidden <input type=file>
};

/* ── Utilities ───────────────────────────────────────────────── */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cssUrl(url) {
  return url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function genId() {
  return 'sec_' + Math.random().toString(36).slice(2, 8);
}

let _toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('ed-toast');
  el.textContent = msg;
  el.className   = 'ed-toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── Auth & API helpers ──────────────────────────────────────── */

function getAuth() {
  const token     = sessionStorage.getItem('upcart_admin_token');
  const workerUrl = sessionStorage.getItem('upcart_worker_url');
  const ctx       = (() => {
    try { return JSON.parse(sessionStorage.getItem('upcart_tenant_ctx') || 'null'); }
    catch { return null; }
  })();
  return { token, workerUrl, ctx };
}

async function apiFetch(path, opts = {}) {
  const { token, workerUrl } = getAuth();
  const res  = await fetch(`${workerUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.data;
}

async function apiUploadImage(file) {
  const { token, workerUrl } = getAuth();
  const fd = new FormData();
  fd.append('file', file);
  const res  = await fetch(`${workerUrl}/admin/images`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    fd,
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.error || 'Upload failed');
  return body.data;
}

/* ── History (undo / redo) ───────────────────────────────────── */

function snapshot() {
  return JSON.stringify({ settings: state.settings, pageSections: state.pageSections });
}

function pushHistory() {
  state.history    = state.history.slice(0, state.historyIdx + 1);
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
  state.historyIdx = state.history.length - 1;
  refreshUndoRedo();
}

function restoreHistory(snap) {
  const s = JSON.parse(snap);
  Object.assign(state.settings, s.settings);
  state.pageSections = s.pageSections;
  renderSectionList();
  renderPropsPanel();
  sendPreview();
  markDirty(true);
}

function undo() {
  if (state.historyIdx <= 0) return;
  state.historyIdx--;
  restoreHistory(state.history[state.historyIdx]);
  refreshUndoRedo();
}

function redo() {
  if (state.historyIdx >= state.history.length - 1) return;
  state.historyIdx++;
  restoreHistory(state.history[state.historyIdx]);
  refreshUndoRedo();
}

function refreshUndoRedo() {
  document.getElementById('ed-undo').disabled = state.historyIdx <= 0;
  document.getElementById('ed-redo').disabled = state.historyIdx >= state.history.length - 1;
}

/* ── Dirty / unsaved indicator ───────────────────────────────── */

function markDirty(dirty) {
  state.dirty = dirty;
  const el = document.getElementById('ed-unsaved');
  dirty ? el.removeAttribute('hidden') : el.setAttribute('hidden', '');
}

/* ── iframe / live preview ───────────────────────────────────── */

function sendPreview() {
  const frame = document.getElementById('ed-iframe');
  if (!frame.contentWindow) return;
  frame.contentWindow.postMessage(
    { type: 'bst:preview', settings: { ...state.settings } },
    state.storeOrigin,
  );
}

function loadPage(pageId) {
  const page = PAGES.find(p => p.id === pageId);
  if (!page || !state.storeUrl) return;
  const frame = document.getElementById('ed-iframe');
  const url   = state.storeUrl.replace(/\/$/, '') + '/' + page.file;
  if (frame.src === url) {
    sendPreview();
    return;
  }
  frame.addEventListener('load', () => setTimeout(sendPreview, 320), { once: true });
  frame.src = url;
}

/* ── Page list ───────────────────────────────────────────────── */

function renderPageList() {
  const el = document.getElementById('ed-page-list');
  el.innerHTML = PAGES.map(p => `
    <button class="ed-nav-item${p.id === state.activePage ? ' active' : ''}" data-page="${p.id}">
      <i class="${p.icon} ed-nav-item__icon"></i>
      <span class="ed-nav-item__name">${esc(p.name)}</span>
    </button>`).join('');

  el.querySelectorAll('.ed-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activePage   = btn.dataset.page;
      state.activeSection = null;
      renderPageList();
      renderSectionList();
      renderPropsPanel();
      loadPage(state.activePage);
    });
  });
}

/* ── Section list ────────────────────────────────────────────── */

function currentSections() {
  return state.pageSections[state.activePage] || [];
}

function renderSectionList() {
  const sections = currentSections();
  const el       = document.getElementById('ed-section-list');

  el.innerHTML = sections.map((sec, i) => {
    const schema  = SECTION_TYPES[sec.type] || {};
    const isFixed = !!schema.fixed;
    const isActive = sec.id === state.activeSection;
    const isHidden = !sec.visible;
    const first    = i === 0;
    const last     = i === sections.length - 1;

    return `
      <div class="ed-nav-item${isActive ? ' active' : ''}${isHidden ? ' dimmed' : ''}"
           data-secid="${esc(sec.id)}">
        <i class="${schema.icon || 'bi-square'} ed-nav-item__icon"></i>
        <span class="ed-nav-item__name">${esc(schema.name || sec.type)}</span>
        ${isFixed ? `<span class="ed-nav-item__badge">Fixed</span>` : ''}
        <div class="ed-nav-item__actions">
          ${!isFixed ? `
            <button class="ed-action-btn" data-action="toggle" data-id="${esc(sec.id)}"
                    title="${isHidden ? 'Show' : 'Hide'} section">
              <i class="bi bi-eye${isHidden ? '-slash' : ''}"></i>
            </button>
            <button class="ed-action-btn" data-action="up" data-id="${esc(sec.id)}"
                    title="Move up" ${first ? 'disabled' : ''}>
              <i class="bi bi-chevron-up"></i>
            </button>
            <button class="ed-action-btn" data-action="down" data-id="${esc(sec.id)}"
                    title="Move down" ${last ? 'disabled' : ''}>
              <i class="bi bi-chevron-down"></i>
            </button>
            <button class="ed-action-btn danger" data-action="remove" data-id="${esc(sec.id)}"
                    title="Remove section">
              <i class="bi bi-trash"></i>
            </button>
          ` : ''}
        </div>
      </div>`;
  }).join('');

  // Click → select section
  el.querySelectorAll('.ed-nav-item').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('.ed-action-btn')) return;
      state.activeSection = btn.dataset.secid;
      renderSectionList();
      renderPropsPanel();
    });
  });

  // Action buttons
  el.querySelectorAll('.ed-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const secs = currentSections();
      const idx  = secs.findIndex(s => s.id === btn.dataset.id);
      if (idx === -1) return;
      const { action } = btn.dataset;

      if (action === 'toggle') {
        secs[idx].visible = !secs[idx].visible;
      } else if (action === 'up' && idx > 0) {
        [secs[idx - 1], secs[idx]] = [secs[idx], secs[idx - 1]];
      } else if (action === 'down' && idx < secs.length - 1) {
        [secs[idx], secs[idx + 1]] = [secs[idx + 1], secs[idx]];
      } else if (action === 'remove') {
        secs.splice(idx, 1);
        if (state.activeSection === btn.dataset.id) {
          state.activeSection = null;
          renderPropsPanel();
        }
      }

      onChange(true);
      renderSectionList();
    });
  });
}

/* ── Add-section popover ─────────────────────────────────────── */

function initAddSectionPopover() {
  const popover   = document.getElementById('ed-add-popover');
  const addBtn    = document.getElementById('ed-add-section');
  const listEl    = document.getElementById('ed-addable-list');

  listEl.innerHTML = ADDABLE_TYPES.map(type => {
    const schema = SECTION_TYPES[type];
    return `
      <button class="ed-nav-item" data-addtype="${type}">
        <i class="${schema.icon} ed-nav-item__icon"></i>
        <span class="ed-nav-item__name">${esc(schema.name)}</span>
      </button>`;
  }).join('');

  listEl.querySelectorAll('.ed-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type     = btn.dataset.addtype;
      const newSec   = { id: genId(), type, visible: true, settings: {} };
      const secs     = currentSections();
      // Insert before last fixed footer, or just append
      const footerIdx = secs.findLastIndex(s => s.type === 'footer');
      if (footerIdx !== -1) secs.splice(footerIdx, 0, newSec);
      else                  secs.push(newSec);

      state.activeSection = newSec.id;
      onChange(true);
      renderSectionList();
      renderPropsPanel();
      popover.classList.add('hidden');
    });
  });

  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    popover.classList.toggle('hidden');
  });
  document.addEventListener('click', () => popover.classList.add('hidden'));
}

/* ── Properties panel ────────────────────────────────────────── */

function renderPropsPanel() {
  if (state.activeSection) {
    const sec = currentSections().find(s => s.id === state.activeSection);
    if (sec) { renderSectionProps(sec); return; }
    state.activeSection = null;
  }
  renderGlobalProps();
}

/* Global / theme panel */
function renderGlobalProps() {
  const s  = state.settings;
  const el = document.getElementById('ed-props');

  const swatches = THEMES.map(t => `
    <button class="ed-theme-swatch${s.theme === t.id ? ' active' : ''}"
            data-theme="${t.id}"
            style="background:${t.bg};color:${t.text}">
      <div class="ed-swatch-bar" style="background:${t.btn}"></div>
      <div class="ed-swatch-body">
        <span class="ed-swatch-name">${t.name}</span>
        <span class="ed-swatch-desc">${t.desc}</span>
      </div>
    </button>`).join('');

  el.innerHTML = `
    <div class="ed-props-title"><i class="bi bi-palette2"></i> Theme &amp; Style</div>
    <div class="ed-props-subtitle">Global design settings applied to all pages.</div>

    <div class="ed-section-label">Preset</div>
    <div class="ed-theme-grid">${swatches}</div>

    <div class="ed-section-label">Brand Colors</div>

    <div class="ed-field">
      <label class="ed-field-label">Primary — buttons &amp; links</label>
      <div class="ed-color-row">
        <input type="color" class="ed-color-picker" id="g-prim-pk" value="${s.brand_primary || '#111111'}">
        <input type="text"  class="ed-input"        id="g-prim"    placeholder="#111111" maxlength="7" value="${esc(s.brand_primary)}">
        <button class="ed-clear-btn" id="g-prim-clr" title="Reset to preset">✕</button>
      </div>
    </div>

    <div class="ed-field">
      <label class="ed-field-label">Accent — highlights &amp; badges</label>
      <div class="ed-color-row">
        <input type="color" class="ed-color-picker" id="g-acc-pk"  value="${s.brand_accent || '#4a9eff'}">
        <input type="text"  class="ed-input"        id="g-acc"     placeholder="#4a9eff" maxlength="7" value="${esc(s.brand_accent)}">
        <button class="ed-clear-btn" id="g-acc-clr" title="Reset to preset">✕</button>
      </div>
    </div>

    <div class="ed-section-label">Store Info</div>

    <div class="ed-field">
      <label class="ed-field-label" for="g-name">Store name</label>
      <input type="text" class="ed-input" id="g-name" value="${esc(s.store_name)}" maxlength="100" placeholder="My Store">
    </div>

    <div class="ed-field">
      <label class="ed-field-label" for="g-desc">Tagline</label>
      <textarea class="ed-textarea" id="g-desc" maxlength="300" placeholder="Short description or slogan">${esc(s.store_description)}</textarea>
    </div>
  `;

  /* Theme swatches */
  el.querySelectorAll('.ed-theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      el.querySelectorAll('.ed-theme-swatch')
        .forEach(b => b.classList.toggle('active', b.dataset.theme === state.settings.theme));
      onChange();
    });
  });

  /* Color helper */
  const bindColor = (key, pkId, txtId, clrId) => {
    const pk  = document.getElementById(pkId);
    const txt = document.getElementById(txtId);
    const clr = document.getElementById(clrId);
    pk.addEventListener('input',  () => { state.settings[key] = pk.value; txt.value = pk.value; onChange(); });
    txt.addEventListener('input', () => {
      const v = /^#[0-9a-fA-F]{6}$/.test(txt.value.trim()) ? txt.value.trim() : '';
      state.settings[key] = v;
      if (v) pk.value = v;
      onChange();
    });
    clr.addEventListener('click', () => { state.settings[key] = ''; txt.value = ''; onChange(); });
  };
  bindColor('brand_primary', 'g-prim-pk', 'g-prim', 'g-prim-clr');
  bindColor('brand_accent',  'g-acc-pk',  'g-acc',  'g-acc-clr');

  /* Text inputs */
  document.getElementById('g-name').addEventListener('input', e => { state.settings.store_name        = e.target.value; onChange(); });
  document.getElementById('g-desc').addEventListener('input', e => { state.settings.store_description = e.target.value; onChange(); });
}

/* Section-specific props panel */
function renderSectionProps(sec) {
  const schema = SECTION_TYPES[sec.type];
  const el     = document.getElementById('ed-props');

  if (!schema) {
    el.innerHTML = `<div class="ed-props-empty"><i class="bi bi-question-circle"></i>Unknown section type.</div>`;
    return;
  }

  if (schema.fields.length === 0) {
    el.innerHTML = `
      <div class="ed-props-title"><i class="${schema.icon}"></i> ${esc(schema.name)}</div>
      <div class="ed-props-empty" style="margin-top:24px">
        <i class="bi bi-sliders"></i>
        This section has no editable content.<br>
        <small style="font-size:11px">Products are managed from the Products tab.</small>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="ed-props-title"><i class="${schema.icon}"></i> ${esc(schema.name)}</div>
    <div class="ed-divider" style="margin-top:8px"></div>
    ${schema.fields.map(f => buildFieldHtml(f, sec)).join('')}
  `;

  schema.fields.forEach(f => wireField(f, sec, el));
}

/* Build HTML for a single field */
function buildFieldHtml(field, sec) {
  // Fields that map to top-level settings (not section-level) are read from state.settings
  const val = isGlobalKey(field.key)
    ? (state.settings[field.key] ?? '')
    : (sec.settings[field.key] ?? '');

  switch (field.type) {
    case 'text':
      return `
        <div class="ed-field">
          <label class="ed-field-label" for="f-${field.key}">${esc(field.label)}</label>
          <input type="text" class="ed-input" id="f-${field.key}"
                 value="${esc(val)}" placeholder="${esc(field.placeholder || '')}"
                 maxlength="${field.maxlength || 200}">
        </div>`;

    case 'textarea':
      return `
        <div class="ed-field">
          <label class="ed-field-label" for="f-${field.key}">${esc(field.label)}</label>
          <textarea class="ed-textarea" id="f-${field.key}"
                    placeholder="${esc(field.placeholder || '')}"
                    maxlength="${field.maxlength || 500}">${esc(val)}</textarea>
        </div>`;

    case 'color':
      return `
        <div class="ed-field">
          <label class="ed-field-label">${esc(field.label)}</label>
          <div class="ed-color-row">
            <input type="color" class="ed-color-picker" id="f-${field.key}-pk" value="${val || '#000000'}">
            <input type="text"  class="ed-input"        id="f-${field.key}"    value="${esc(val)}" placeholder="#000000" maxlength="7">
            <button class="ed-clear-btn" id="f-${field.key}-clr" title="Clear">✕</button>
          </div>
        </div>`;

    case 'image':
      return `
        <div class="ed-field">
          <label class="ed-field-label">${esc(field.label)}</label>
          <div class="ed-image-preview" id="f-${field.key}-prev"
               ${val ? `style="background-image:url('${cssUrl(val)}')"` : ''}></div>
          <div class="ed-image-actions">
            <button class="ed-image-upload-btn" id="f-${field.key}-upload">
              <i class="bi bi-upload"></i> Upload
            </button>
            <button class="ed-image-remove-btn" id="f-${field.key}-remove">Remove</button>
          </div>
          <div class="ed-image-status" id="f-${field.key}-status"></div>
        </div>`;

    case 'select': {
      const opts = (field.options || []).map(o =>
        `<option value="${esc(o.value)}"${val === o.value ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      return `
        <div class="ed-field">
          <label class="ed-field-label" for="f-${field.key}">${esc(field.label)}</label>
          <select class="ed-select" id="f-${field.key}">${opts}</select>
        </div>`;
    }

    default: return '';
  }
}

/* Wire up a field's event listeners */
function wireField(field, sec, container) {
  const setVal = (key, value) => {
    if (isGlobalKey(key)) state.settings[key] = value;
    else                  sec.settings[key]   = value;
    onChange();
  };

  if (field.type === 'text' || field.type === 'textarea') {
    const el = container.querySelector(`#f-${field.key}`);
    if (el) el.addEventListener('input', () => setVal(field.key, el.value));
  }

  if (field.type === 'color') {
    const pk  = container.querySelector(`#f-${field.key}-pk`);
    const txt = container.querySelector(`#f-${field.key}`);
    const clr = container.querySelector(`#f-${field.key}-clr`);
    if (pk)  pk.addEventListener('input',  () => { setVal(field.key, pk.value); if (txt) txt.value = pk.value; });
    if (txt) txt.addEventListener('input', () => {
      const v = /^#[0-9a-fA-F]{6}$/.test(txt.value.trim()) ? txt.value.trim() : '';
      setVal(field.key, v);
      if (v && pk) pk.value = v;
    });
    if (clr) clr.addEventListener('click', () => {
      setVal(field.key, '');
      if (txt) txt.value = '';
    });
  }

  if (field.type === 'image') {
    const prev      = container.querySelector(`#f-${field.key}-prev`);
    const uploadBtn = container.querySelector(`#f-${field.key}-upload`);
    const removeBtn = container.querySelector(`#f-${field.key}-remove`);
    const status    = container.querySelector(`#f-${field.key}-status`);

    // Reuse a single hidden file input per page
    if (!state._fileInput) {
      state._fileInput       = document.createElement('input');
      state._fileInput.type  = 'file';
      state._fileInput.accept = 'image/*';
      state._fileInput.style.display = 'none';
      document.body.appendChild(state._fileInput);
    }
    const fi = state._fileInput;

    uploadBtn.addEventListener('click', () => {
      fi.value   = '';
      fi.onchange = async () => {
        const file = fi.files?.[0];
        if (!file) return;
        if (status) { status.textContent = 'Uploading…'; status.style.color = ''; }
        try {
          const { url } = await apiUploadImage(file);
          setVal(field.key, url);
          if (prev) prev.style.backgroundImage = `url('${cssUrl(url)}')`;
          if (status) { status.textContent = 'Uploaded.'; status.style.color = '#4ade80'; }
        } catch (e) {
          if (status) { status.textContent = `Upload failed: ${e.message}`; status.style.color = '#f87171'; }
        }
      };
      fi.click();
    });

    removeBtn.addEventListener('click', () => {
      setVal(field.key, '');
      if (prev) prev.style.backgroundImage = '';
      if (status) status.textContent = '';
    });
  }

  if (field.type === 'select') {
    const el = container.querySelector(`#f-${field.key}`);
    if (el) el.addEventListener('change', () => setVal(field.key, el.value));
  }
}

/* Which setting keys live in state.settings (not in section.settings) */
function isGlobalKey(key) {
  return [
    'store_name', 'store_description', 'logo_url',
    'hero_title', 'hero_subtitle', 'hero_cta',
  ].includes(key);
}

/* ── Change handling ─────────────────────────────────────────── */

let _historyDebounce;

function onChange(force = false) {
  sendPreview();
  markDirty(true);
  clearTimeout(_historyDebounce);
  if (force) {
    pushHistory();
  } else {
    _historyDebounce = setTimeout(pushHistory, 700);
  }
}

/* ── Save ────────────────────────────────────────────────────── */

async function save() {
  const btn = document.getElementById('ed-save');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const payload = {
      ...state.settings,
      page_sections: JSON.stringify(state.pageSections),
    };
    // Drop undefined values
    for (const k of Object.keys(payload)) {
      if (payload[k] === undefined) delete payload[k];
    }

    await apiFetch('/admin/settings', {
      method: 'PUT',
      body:   JSON.stringify(payload),
    });

    markDirty(false);
    showToast('Saved & published!', 'success');
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2"></i> Save';
  }
}

/* ── Viewport toggle ─────────────────────────────────────────── */

function initViewportToggle() {
  const wrap    = document.getElementById('ed-frame-wrap');
  const buttons = {
    desktop: document.getElementById('vp-desktop'),
    tablet:  document.getElementById('vp-tablet'),
    mobile:  document.getElementById('vp-mobile'),
  };

  Object.entries(buttons).forEach(([vp, btn]) => {
    btn.addEventListener('click', () => {
      Object.values(buttons).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wrap.className = 'ed-frame-wrap' + (vp !== 'desktop' ? ` vp-${vp}` : '');
    });
  });
}

/* ── Bootstrap ───────────────────────────────────────────────── */

async function init() {
  const { token, workerUrl, ctx } = getAuth();
  if (!token || !workerUrl) {
    window.location.href = '/';
    return;
  }

  state.storeUrl = ctx?.store_url || '';
  try {
    state.storeOrigin = state.storeUrl ? new URL(state.storeUrl).origin : '*';
  } catch { /* keep '*' */ }

  /* Open-store button */
  const openStoreBtn = document.getElementById('ed-open-store');
  if (state.storeUrl) openStoreBtn.href = state.storeUrl;
  else                openStoreBtn.style.display = 'none';

  /* Load settings from API */
  try {
    const data = await apiFetch('/admin/settings');
    Object.assign(state.settings, {
      theme:             data.theme             || 'base',
      brand_primary:     data.brand_primary     || '',
      brand_accent:      data.brand_accent      || '',
      logo_url:          data.logo_url          || '',
      store_name:        data.store_name        || ctx?.store_name || '',
      store_description: data.store_description || '',
      hero_title:        data.hero_title        || '',
      hero_subtitle:     data.hero_subtitle     || '',
      hero_cta:          data.hero_cta          || '',
    });

    // Restore saved section layout
    if (data.page_sections) {
      try {
        const parsed = JSON.parse(data.page_sections);
        for (const pid of Object.keys(DEFAULT_SECTIONS)) {
          if (parsed[pid]) state.pageSections[pid] = parsed[pid];
        }
      } catch { /* keep defaults */ }
    }

    document.getElementById('ed-store-name').textContent = state.settings.store_name || 'Store Editor';
  } catch (e) {
    showToast(`Failed to load settings: ${e.message}`, 'danger');
  }

  /* Build UI */
  renderPageList();
  renderSectionList();
  renderPropsPanel();
  initAddSectionPopover();
  initViewportToggle();
  pushHistory();   // initial history entry

  /* Wire global actions */
  document.getElementById('ed-undo').addEventListener('click', undo);
  document.getElementById('ed-redo').addEventListener('click', redo);
  document.getElementById('ed-save').addEventListener('click', save);

  /* Back button — warn on dirty */
  document.getElementById('ed-back').addEventListener('click', e => {
    if (state.dirty && !confirm('You have unsaved changes. Leave the editor anyway?')) {
      e.preventDefault();
    }
  });

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo(); }
    if (e.key === 'y')                { e.preventDefault(); redo(); }
    if (e.key === 's')                { e.preventDefault(); save(); }
  });

  /* Load iframe */
  if (state.storeUrl) {
    const frame = document.getElementById('ed-iframe');
    frame.addEventListener('load', () => setTimeout(sendPreview, 320), { once: true });
    frame.src = state.storeUrl.replace(/\/$/, '') + '/index.html';
  } else {
    document.getElementById('ed-frame-wrap').classList.add('hidden');
    document.getElementById('ed-no-url').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
