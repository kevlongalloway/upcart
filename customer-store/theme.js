'use strict';
/**
 * BST Theme Loader
 *
 * Reads window.STORE_THEME (set in config.js, injected by provisioning service
 * from store_settings.theme) and synchronously injects CSS custom properties
 * into the document head before the page paints — zero FOUC for colors/layout.
 * Google Fonts are loaded asynchronously (font-display:swap handles flash).
 *
 * Available themes: mono | minimal | boutique | bold | studio
 */
(function () {
  /* ── Theme definitions ───────────────────────────────────────────────────── */
  var THEMES = {

    // ── Mono ─────────────────────────────────────────────────────────────────
    // Editorial monochrome. Space Mono everywhere, Bebas Neue for hero text.
    mono: {
      fonts: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap',
      vars: [
        '--font-body:"Space Mono",monospace',
        '--font-display:"Space Mono",monospace',
        '--font-hero:"Bebas Neue",sans-serif',
        '--color-bg:#f5f5f5',
        '--color-text:#1a1a1a',
        '--color-surface:#e8e8e8',
        '--color-surface-border:#ddd',
        '--color-border:rgba(26,26,26,0.1)',
        '--color-border-mid:rgba(26,26,26,0.2)',
        '--color-ticker-bg:#e0e0e0',
        '--color-ticker-text:#1a1a1a',
        '--color-footer-bg:#2a2a2a',
        '--color-footer-text:#f5f5f5',
        '--color-footer-border:rgba(245,245,245,0.1)',
        '--color-btn-bg:#1a1a1a',
        '--color-btn-text:#f5f5f5',
      ],
    },

    // ── Minimal ───────────────────────────────────────────────────────────────
    // Pure white, clean Inter type. Sleek and corporate.
    minimal: {
      fonts: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
      vars: [
        '--font-body:"Inter",sans-serif',
        '--font-display:"Inter",sans-serif',
        '--font-hero:"Inter",sans-serif',
        '--color-bg:#ffffff',
        '--color-text:#111111',
        '--color-surface:#f4f4f4',
        '--color-surface-border:#e5e5e5',
        '--color-border:rgba(0,0,0,0.08)',
        '--color-border-mid:rgba(0,0,0,0.15)',
        '--color-ticker-bg:#f0f0f0',
        '--color-ticker-text:#111111',
        '--color-footer-bg:#111111',
        '--color-footer-text:#f9f9f9',
        '--color-footer-border:rgba(249,249,249,0.1)',
        '--color-btn-bg:#111111',
        '--color-btn-text:#ffffff',
      ],
    },

    // ── Boutique ──────────────────────────────────────────────────────────────
    // Cream / ivory, Playfair Display serifs, warm earth tones. Luxury fashion.
    boutique: {
      fonts: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@400;700&display=swap',
      vars: [
        '--font-body:"Lato",sans-serif',
        '--font-display:"Playfair Display",serif',
        '--font-hero:"Playfair Display",serif',
        '--color-bg:#faf7f2',
        '--color-text:#2c1810',
        '--color-surface:#f0ebe2',
        '--color-surface-border:#e2d9cc',
        '--color-border:rgba(44,24,16,0.08)',
        '--color-border-mid:rgba(44,24,16,0.15)',
        '--color-ticker-bg:#e8e0d5',
        '--color-ticker-text:#2c1810',
        '--color-footer-bg:#2c1810',
        '--color-footer-text:#faf7f2',
        '--color-footer-border:rgba(250,247,242,0.1)',
        '--color-btn-bg:#2c1810',
        '--color-btn-text:#faf7f2',
      ],
    },

    // ── Bold ──────────────────────────────────────────────────────────────────
    // Near-black bg, Bebas Neue display, gold accent. Streetwear / hype.
    bold: {
      fonts: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;600;700&display=swap',
      vars: [
        '--font-body:"Oswald",sans-serif',
        '--font-display:"Bebas Neue",sans-serif',
        '--font-hero:"Bebas Neue",sans-serif',
        '--color-bg:#0a0a0a',
        '--color-text:#f0f0f0',
        '--color-surface:#1a1a1a',
        '--color-surface-border:#2a2a2a',
        '--color-border:rgba(240,240,240,0.1)',
        '--color-border-mid:rgba(240,240,240,0.2)',
        '--color-ticker-bg:#f5c000',
        '--color-ticker-text:#0a0a0a',
        '--color-footer-bg:#111111',
        '--color-footer-text:#f0f0f0',
        '--color-footer-border:rgba(240,240,240,0.1)',
        '--color-btn-bg:#f5c000',
        '--color-btn-text:#0a0a0a',
      ],
    },

    // ── Studio ────────────────────────────────────────────────────────────────
    // Warm off-white, DM Serif Display headings, terracotta CTA. Artisan/craft.
    studio: {
      fonts: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&display=swap',
      vars: [
        '--font-body:"DM Sans",sans-serif',
        '--font-display:"DM Serif Display",serif',
        '--font-hero:"DM Serif Display",serif',
        '--color-bg:#f5f0ea',
        '--color-text:#2d2419',
        '--color-surface:#ede6db',
        '--color-surface-border:#d9cfc2',
        '--color-border:rgba(45,36,25,0.1)',
        '--color-border-mid:rgba(45,36,25,0.18)',
        '--color-ticker-bg:#e8dfd3',
        '--color-ticker-text:#2d2419',
        '--color-footer-bg:#2d2419',
        '--color-footer-text:#f5f0ea',
        '--color-footer-border:rgba(245,240,234,0.1)',
        '--color-btn-bg:#c4603a',
        '--color-btn-text:#ffffff',
      ],
    },
  };

  /* ── Apply theme ─────────────────────────────────────────────────────────── */
  var name  = String(window.STORE_THEME || 'mono').replace(/[^a-z0-9-]/g, '');
  var theme = THEMES[name] || THEMES.mono;

  // Inject CSS custom properties synchronously — zero layout FOUC.
  var style       = document.createElement('style');
  style.id        = 'bst-theme-vars';
  style.textContent = ':root{' + theme.vars.join(';') + '}';
  document.head.appendChild(style);

  // Load Google Fonts asynchronously (font-display:swap already in URL).
  if (theme.fonts) {
    var pc1      = document.createElement('link');
    pc1.rel      = 'preconnect';
    pc1.href     = 'https://fonts.googleapis.com';
    document.head.appendChild(pc1);

    var pc2          = document.createElement('link');
    pc2.rel          = 'preconnect';
    pc2.href         = 'https://fonts.gstatic.com';
    pc2.crossOrigin  = '';
    document.head.appendChild(pc2);

    var fl   = document.createElement('link');
    fl.rel   = 'stylesheet';
    fl.href  = theme.fonts;
    document.head.appendChild(fl);
  }

  // Expose active theme name for other scripts.
  window.BST_THEME = name;
})();
