'use strict';
/**
 * Upcart Theme Loader
 *
 * Theme selection is schema-driven. The merchant's look lives in their saved
 * schema (`store_settings.page_sections` → `globalTheme`), which is the single
 * source of truth:
 *   • store-renderer.js renders the homepage + header/footer slots from that
 *     schema and emits the modern `--uc-*` CSS variables.
 *   • this loader paints a synchronous editorial-luxe BASELINE (zero FOUC) and
 *     then BRIDGES the merchant's `globalTheme` onto the legacy `--color-*` /
 *     `--font-*` variables that the static sub-page chrome (products / cart)
 *     still consumes — so every page reflects the chosen theme.
 *
 * The old build-time `window.STORE_THEME` preset switch has been retired; the
 * five hand-maintained CSS palettes are gone. `brand_primary` / `brand_accent`
 * still override on top for quick recolors from the dashboard.
 */
(function () {
  /* ── Editorial-luxe baseline (the real "base" theme) ─────────────────────
     Painted synchronously before first paint so there is never a flash of
     unstyled content, even if the live-settings fetch below fails. */
  var BASE_FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Inter+Tight:wght@300;400;500;600;700&display=swap';
  var BASE_VARS = [
    '--font-body:"Inter Tight","Inter",system-ui,-apple-system,sans-serif',
    '--font-display:"Fraunces","Times New Roman",Georgia,serif',
    '--font-hero:"Fraunces","Times New Roman",Georgia,serif',
    '--color-bg:#F4EFE6',
    '--color-text:#161310',
    '--color-muted:#807767',
    '--color-surface:#FBF7EE',
    '--color-surface-border:#E4DCC9',
    '--color-border:#E4DCC9',
    '--color-border-mid:rgba(22,19,16,0.14)',
    '--color-accent:#B8884A',
    '--color-accent-d:#8C6128',
    '--color-accent-soft:rgba(184,136,74,0.14)',
    '--color-danger:#B84C4C',
    '--color-ticker-bg:#161310',
    '--color-ticker-text:#FBF7EE',
    '--color-footer-bg:#161310',
    '--color-footer-text:#FBF7EE',
    '--color-footer-border:rgba(251,247,238,0.10)',
    '--color-btn-bg:#161310',
    '--color-btn-text:#FBF7EE',
  ];

  (function paintBaseline() {
    var style = document.createElement('style');
    style.id = 'bst-theme-vars';
    style.textContent = ':root{' + BASE_VARS.join(';') + '}';
    document.head.appendChild(style);

    if (!document.querySelector('link[data-bst-preconnect="google"]')) {
      var pc1 = document.createElement('link');
      pc1.rel = 'preconnect';
      pc1.href = 'https://fonts.googleapis.com';
      pc1.setAttribute('data-bst-preconnect', 'google');
      document.head.appendChild(pc1);

      var pc2 = document.createElement('link');
      pc2.rel = 'preconnect';
      pc2.href = 'https://fonts.gstatic.com';
      pc2.crossOrigin = '';
      pc2.setAttribute('data-bst-preconnect', 'gstatic');
      document.head.appendChild(pc2);
    }

    var fl = document.createElement('link');
    fl.id = 'bst-theme-fonts';
    fl.rel = 'stylesheet';
    fl.href = BASE_FONTS;
    document.head.appendChild(fl);

    window.BST_THEME = 'base';
  })();

  function contrastText(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var y = (r * 299 + g * 587 + b * 114) / 1000;
    return y >= 150 ? '#111111' : '#ffffff';
  }

  /* ── globalTheme → legacy CSS vars bridge ────────────────────────────────
     Maps the saved schema's design tokens onto the `--color-*` / `--font-*`
     variables the static sub-page chrome reads. Font FILES are loaded by
     store-renderer.js (which runs on sub-pages too); here we only point the
     family names so the cascade matches. */
  function bridgeFromGlobalTheme(gt) {
    if (!gt || !gt.colors) return [];
    var c = gt.colors;
    var t = gt.typography || {};
    var out = [];
    function set(k, v) { if (v) out.push(k + ':' + v); }
    set('--color-bg', c.background);
    set('--color-text', c.text);
    set('--color-muted', c.textMuted);
    set('--color-surface', c.surface);
    set('--color-surface-border', c.border);
    set('--color-border', c.border);
    set('--color-accent', c.accent);
    set('--color-ticker-bg', c.primary);
    set('--color-ticker-text', c.primaryText);
    set('--color-footer-bg', c.primary);
    set('--color-footer-text', c.primaryText);
    set('--color-btn-bg', c.primary);
    set('--color-btn-text', c.primaryText);
    if (t.headingFont && t.headingFont !== 'inherit') {
      set('--font-display', "'" + t.headingFont + "',Georgia,serif");
      set('--font-hero',    "'" + t.headingFont + "',Georgia,serif");
    }
    if (t.bodyFont && t.bodyFont !== 'inherit') {
      set('--font-body', "'" + t.bodyFont + "',system-ui,sans-serif");
    }
    return out;
  }

  function globalThemeFrom(settings) {
    if (!settings || !settings.page_sections) return null;
    try {
      var s = JSON.parse(settings.page_sections);
      return s && s.globalTheme ? s.globalTheme : null;
    } catch (e) {
      return null;
    }
  }

  function applyBrandOverrides(settings) {
    if (!settings) return;

    // Theme tokens first, then explicit brand colors so they win.
    var overrides = bridgeFromGlobalTheme(globalThemeFrom(settings));

    if (/^#[0-9a-fA-F]{6}$/.test(settings.brand_primary || '')) {
      overrides.push('--color-btn-bg:' + settings.brand_primary);
      overrides.push('--color-footer-bg:' + settings.brand_primary);
      overrides.push('--color-btn-text:' + contrastText(settings.brand_primary));
      overrides.push('--color-footer-text:' + contrastText(settings.brand_primary));
    }
    if (/^#[0-9a-fA-F]{6}$/.test(settings.brand_accent || '')) {
      overrides.push('--color-ticker-bg:' + settings.brand_accent);
      overrides.push('--color-ticker-text:' + contrastText(settings.brand_accent));
    }

    if (overrides.length) {
      var existingOverrides = document.getElementById('bst-theme-overrides');
      if (existingOverrides) existingOverrides.remove();
      var st = document.createElement('style');
      st.id  = 'bst-theme-overrides';
      st.textContent = ':root{' + overrides.join(';') + '}';
      document.head.appendChild(st);
    }

    // Expose live settings so header/footer partials can pick them up.
    window.STORE_SETTINGS = settings;

    var apply = function () {
      if (settings.store_name) {
        var nameNodes = document.querySelectorAll('[data-store-name],.footer-brand-name,.brand-text,.brand-name');
        nameNodes.forEach(function (n) { n.textContent = settings.store_name; });
        if (document.title && /^(\s*|Demo Store)$/.test(document.title)) {
          document.title = settings.store_name;
        }
      }
      if (settings.store_description) {
        document.querySelectorAll('[data-store-description]').forEach(function (n) {
          n.textContent = settings.store_description;
        });
      }
      document.querySelectorAll('[data-store-logo]').forEach(function (n) {
        if (n.tagName === 'IMG') {
          if (settings.logo_url) {
            n.src = settings.logo_url;
            n.alt = settings.store_name || '';
            n.classList.add('has-logo');
          } else {
            n.classList.remove('has-logo');
          }
        } else if (settings.logo_url) {
          n.style.backgroundImage = 'url("' + settings.logo_url.replace(/"/g,'%22') + '")';
        }
      });
      // Hero section content — only override the title when the merchant has
      // explicitly set hero_title (avoids duplicating the store name next to
      // the header wordmark).
      if (settings.hero_title) {
        document.querySelectorAll('[data-hero-title]').forEach(function (n) {
          n.textContent = settings.hero_title;
        });
      }
      if (settings.hero_subtitle) {
        document.querySelectorAll('[data-hero-subtitle]').forEach(function (n) { n.textContent = settings.hero_subtitle; });
      } else if (settings.store_description) {
        document.querySelectorAll('[data-hero-subtitle]').forEach(function (n) { n.textContent = settings.store_description; });
      }
      if (settings.hero_cta) {
        document.querySelectorAll('[data-hero-cta]').forEach(function (n) { n.textContent = settings.hero_cta; });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }

    var evt = new CustomEvent('bst:settings', { detail: settings });
    document.dispatchEvent(evt);
  }

  // Expose a re-apply hook so store-renderer.js can repopulate
  // [data-store-name] / [data-hero-title] / etc. on the new DOM after it
  // re-renders sections from the saved schema.
  window.applyStoreBrand = function () {
    if (window.STORE_SETTINGS) applyBrandOverrides(window.STORE_SETTINGS);
  };

  /* ── Fetch live brand settings (async, non-blocking) ──────────────────── */
  var base = String(window.BST_API_BASE || '').replace(/\/$/, '');
  fetch(base + '/settings/public', { credentials: 'omit' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (body) {
      if (body && body.ok && body.data) applyBrandOverrides(body.data);
    })
    .catch(function () { /* silent — keep the baseline */ });

  // Live preview bridge: the admin dashboard customizer sends postMessage
  // events when a merchant tweaks settings without saving. We apply them
  // immediately so changes are visible in the iframe preview.
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'bst:preview') return;
    if (e.source !== window.parent) return;
    applyBrandOverrides(e.data.settings);
  });
})();
