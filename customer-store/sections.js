'use strict';
/**
 * Upcart Sections Template Engine
 *
 * Defines the canonical schema for all section types used by both
 * the Store Editor (editor.js) and the storefront renderer.
 *
 * The editor reads window.SECTION_SCHEMAS to build its properties UI.
 * The storefront calls window.UC.renderPageSections() to inject
 * dynamic sections from the page_sections config stored in settings.
 *
 * Usage (storefront pages):
 *   <script src="sections.js"></script>
 *   <script>
 *     document.addEventListener('DOMContentLoaded', function () {
 *       UC.renderPageSections('home', window.STORE_SETTINGS);
 *     });
 *   </script>
 *
 * The editor sends live section layout updates via postMessage:
 *   { type: 'bst:sections', pageId: 'home', sections: [...] }
 */
(function () {

  /* ── Section schemas ─────────────────────────────────────────
     Each schema describes the editable fields for a section type.
     The editor reads these to build its right-hand properties panel.
  ─────────────────────────────────────────────────────────────── */
  var SECTION_SCHEMAS = {

    header: {
      name:  'Header',
      fixed: true,
      fields: [
        { key: 'store_name', type: 'text',  label: 'Store Name' },
        { key: 'logo_url',   type: 'image', label: 'Logo'       },
      ],
    },

    hero: {
      name: 'Hero Banner',
      fields: [
        { key: 'hero_title',    type: 'text',     label: 'Headline'    },
        { key: 'hero_subtitle', type: 'textarea', label: 'Subheadline' },
        { key: 'hero_cta',      type: 'text',     label: 'Button text' },
      ],
    },

    'product-grid': {
      name:   'Product Grid',
      fields: [],
    },

    'announcement-bar': {
      name: 'Announcement Bar',
      fields: [
        { key: 'announce_text',  type: 'text',  label: 'Message'          },
        { key: 'announce_bg',    type: 'color', label: 'Background color' },
        { key: 'announce_color', type: 'color', label: 'Text color'       },
      ],
    },

    'text-block': {
      name: 'Text Block',
      fields: [
        { key: 'text_heading', type: 'text',     label: 'Heading' },
        { key: 'text_body',    type: 'textarea', label: 'Body'    },
      ],
    },

    footer: {
      name:  'Footer',
      fixed: true,
      fields: [
        { key: 'store_description', type: 'textarea', label: 'Tagline' },
      ],
    },

  };

  /* ── Section HTML renderers ──────────────────────────────────
     Each renderer receives (section, storeSettings) and returns
     an HTML string, or '' to skip rendering.
     header / product-grid / footer are handled by the existing
     static HTML — only dynamic-only sections need renderers here.
  ─────────────────────────────────────────────────────────────── */
  var RENDERERS = {

    'announcement-bar': function (sec, s) {
      var text  = sec.settings.announce_text  || '';
      if (!text) return '';
      var bg    = sec.settings.announce_bg    || (s && s.brand_accent) || 'var(--color-ticker-bg, #111)';
      var color = sec.settings.announce_color || 'var(--color-ticker-text, #fff)';
      return '<div class="uc-announce-bar" data-section-id="' + esc(sec.id) + '" ' +
             'style="background:' + esc(bg) + ';color:' + esc(color) + ';' +
             'text-align:center;padding:10px 16px;font-size:12px;letter-spacing:.06em">' +
             esc(text) + '</div>';
    },

    'text-block': function (sec) {
      var heading = sec.settings.text_heading || '';
      var body    = sec.settings.text_body    || '';
      if (!heading && !body) return '';
      return '<section class="uc-text-block" data-section-id="' + esc(sec.id) + '" ' +
             'style="padding:60px 24px;max-width:720px;margin:0 auto">' +
             (heading ? '<h2 style="font-family:var(--font-display,inherit);' +
               'font-size:clamp(22px,4vw,38px);margin-bottom:14px">' + esc(heading) + '</h2>' : '') +
             (body    ? '<p style="font-size:15px;line-height:1.7;opacity:.8">'    + esc(body)    + '</p>' : '') +
             '</section>';
    },

  };

  /* ── Helpers ─────────────────────────────────────────────────── */

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Public API ───────────────────────────────────────────────── */

  /**
   * renderSection(sec, storeSettings) → HTML string
   * Returns rendered HTML for a single section, or '' if not renderable.
   */
  function renderSection(sec, storeSettings) {
    if (!sec || !sec.visible) return '';
    var renderer = RENDERERS[sec.type];
    return renderer ? renderer(sec, storeSettings) : '';
  }

  /**
   * renderPageSections(pageId, storeSettings, container)
   *
   * Reads window.PAGE_SECTIONS[pageId] and injects renderable sections
   * into `container` (a DOM element). Non-renderable sections (header,
   * product-grid, footer) are already in the static HTML.
   *
   * Call this after DOMContentLoaded when PAGE_SECTIONS is available.
   */
  function renderPageSections(pageId, storeSettings, container) {
    var pageSections = window.PAGE_SECTIONS;
    if (!pageSections) return;
    var sections = pageSections[pageId];
    if (!Array.isArray(sections)) return;

    var html = '';
    sections.forEach(function (sec) {
      html += renderSection(sec, storeSettings);
    });

    if (html && container) {
      // Insert dynamic sections at the top of the container
      container.insertAdjacentHTML('afterbegin', html);
    }
  }

  /**
   * applyLiveSections(pageId, sections, storeSettings)
   *
   * Called when the editor pushes a live section update via postMessage.
   * Removes previously injected sections and re-renders.
   */
  function applyLiveSections(pageId, sections, storeSettings) {
    // Remove any previously rendered dynamic sections
    document.querySelectorAll('[data-section-id]').forEach(function (el) {
      el.remove();
    });

    var container = document.querySelector('[data-sections-container]') || document.body;
    sections.forEach(function (sec) {
      var html = renderSection(sec, storeSettings);
      if (html) container.insertAdjacentHTML('afterbegin', html);
    });
  }

  /* ── Editor postMessage bridge (sections) ────────────────────── */
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'bst:sections') return;
    if (e.source !== window.parent) return;
    applyLiveSections(e.data.pageId, e.data.sections || [], window.STORE_SETTINGS || {});
  });

  /* ── Expose globals ──────────────────────────────────────────── */
  window.SECTION_SCHEMAS     = SECTION_SCHEMAS;
  window.UC = {
    renderSection,
    renderPageSections,
    applyLiveSections,
  };

})();
