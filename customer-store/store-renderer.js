/* =================================================================
   Upcart Store Renderer v2
   Renders a StoreSchema JSON object into the page DOM.
   Listens for postMessage { type: 'bst:schema', schema: {...} }.
================================================================= */

(function () {
  'use strict';

  /* ── CSS helpers ──────────────────────────────────────────────────────── */

  function bgToCss(bg) {
    if (!bg) return '';
    switch (bg.type) {
      case 'gradient':
        return bg.gradientType === 'radial'
          ? `background: radial-gradient(circle, ${bg.gradientFrom}, ${bg.gradientTo});`
          : `background: linear-gradient(${bg.gradientAngle}deg, ${bg.gradientFrom}, ${bg.gradientTo});`;
      case 'image':
        if (!bg.imageUrl) return `background-color: ${bg.color};`;
        return [
          `background-image: url(${JSON.stringify(bg.imageUrl)});`,
          `background-size: ${bg.backgroundSize};`,
          `background-position: ${bg.backgroundPosition};`,
          `background-repeat: no-repeat;`,
          bg.parallax ? 'background-attachment: fixed;' : '',
        ].join('\n');
      case 'video':
        return `background-color: ${bg.color};`;
      default:
        return `background-color: ${bg.color};`;
    }
  }

  function spacingToCss(sp, prop) {
    if (!sp) return '';
    return `${prop}: ${sp.top}px ${sp.right}px ${sp.bottom}px ${sp.left}px;`;
  }

  function themeToCssVars(theme) {
    const c  = theme.colors;
    const t  = theme.typography;
    const sp = theme.spacing;
    return `
      --uc-primary:       ${c.primary};
      --uc-primary-text:  ${c.primaryText};
      --uc-secondary:     ${c.secondary};
      --uc-accent:        ${c.accent};
      --uc-bg:            ${c.background};
      --uc-surface:       ${c.surface};
      --uc-text:          ${c.text};
      --uc-text-muted:    ${c.textMuted};
      --uc-border:        ${c.border};
      --uc-heading-font:  ${t.headingFont === 'inherit' ? 'inherit' : `'${t.headingFont}', sans-serif`};
      --uc-body-font:     ${t.bodyFont   === 'inherit' ? 'inherit' : `'${t.bodyFont}',   sans-serif`};
      --uc-base-font-size: ${t.baseFontSize}px;
      --uc-heading-weight: ${t.headingWeight};
      --uc-body-weight:    ${t.bodyWeight};
      --uc-line-height:    ${t.lineHeight};
      --uc-letter-spacing: ${t.letterSpacing}em;
      --uc-container-max:  ${sp.containerMaxWidth}px;
      --uc-section-pad:    ${sp.sectionVerticalPadding}px;
      --uc-radius:         ${sp.borderRadius}px;
      --uc-card-radius:    ${sp.cardBorderRadius}px;
      --uc-gap:            ${sp.elementGap}px;
    `;
  }

  function loadGoogleFont(family) {
    if (!family || family === 'inherit') return;
    const id = 'gf-' + family.replace(/\s+/g, '-').toLowerCase();
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  }

  /* ── Section width helper ─────────────────────────────────────────────── */

  const WIDTH_CLASS = {
    full:      'uc-w-full',
    wide:      'uc-w-wide',
    contained: 'uc-w-contained',
    narrow:    'uc-w-narrow',
  };

  function wrapContainer(inner, layout) {
    const wClass = WIDTH_CLASS[layout.width] || 'uc-w-contained';
    const align  = layout.contentAlign === 'center' ? 'style="margin-inline:auto;text-align:center"'
                 : layout.contentAlign === 'right'  ? 'style="margin-left:auto;text-align:right"'
                 : '';
    return `<div class="uc-container ${wClass}" ${align}>${inner}</div>`;
  }

  /* ── Button renderer ──────────────────────────────────────────────────── */

  function renderButton(btn) {
    if (!btn || !btn.label) return '';
    const target = btn.openInNewTab ? ' target="_blank" rel="noreferrer"' : '';
    const style  = [
      `background-color:${btn.variant === 'outline' || btn.variant === 'ghost' ? 'transparent' : btn.backgroundColor}`,
      `color:${btn.variant === 'outline' || btn.variant === 'ghost' ? btn.borderColor : btn.textColor}`,
      `border:${btn.borderWidth}px solid ${btn.borderColor}`,
      `border-radius:${btn.borderRadius}px`,
      `padding:${btn.paddingY}px ${btn.paddingX}px`,
      `font-size:${btn.fontSize}px`,
      `font-weight:${btn.fontWeight}`,
      `display:inline-flex;align-items:center;justify-content:center`,
      btn.fullWidth ? 'width:100%' : '',
      btn.variant === 'link' ? 'text-decoration:underline' : '',
    ].filter(Boolean).join(';');
    return `<a href="${btn.url || '#'}"${target} class="uc-btn" style="${style}">${btn.label}</a>`;
  }

  /* ── Section renderers ────────────────────────────────────────────────── */

  const RENDERERS = {

    'announcement-bar': (sec) => {
      const s = sec.settings;
      const bar = document.createElement('div');
      bar.className = `uc-announcement-bar`;
      bar.style.cssText = `background-color:${s.backgroundColor||'var(--uc-primary)'};color:${s.textColor||'var(--uc-primary-text)'};padding:${s.height||40}px 24px;text-align:center;font-size:${s.fontSize||14}px;`;
      const closeBtn = s.dismissible ? `<button onclick="this.parentElement.style.display='none'" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);background:none;border:none;color:inherit;cursor:pointer;font-size:18px">×</button>` : '';
      bar.style.position = 'relative';
      bar.innerHTML = `${s.text || 'Welcome!'} ${s.linkText ? `<a href="${s.linkUrl||'#'}" style="color:inherit;font-weight:600;margin-left:8px">${s.linkText}</a>` : ''}${closeBtn}`;
      return bar.outerHTML;
    },

    'header': (sec) => {
      const s = sec.settings;
      // Pull links from blocks (`nav-link`) if present, otherwise from settings.navLinks array.
      const blockLinks = (sec.blocks || []).filter(b => b.type === 'nav-link' && b.visible !== false)
        .map(b => ({ url: b.settings.url, label: b.settings.label }));
      const settingLinks = Array.isArray(s.navLinks) ? s.navLinks : [];
      const allLinks = blockLinks.length ? blockLinks : settingLinks;
      const links = allLinks
        .map(l => `<a href="${l.url||'#'}" class="uc-nav-link" style="color:${s.linkColor||s.textColor||'inherit'};font-size:${s.linkSize||13}px;letter-spacing:.04em;text-decoration:none;opacity:.8">${l.label||''}</a>`)
        .join('');
      const storeName = s.storeName || s.logoAlt || 'My Store';
      // The base theme uses a system-font wordmark by default — switch to the
      // global display font only when the merchant opts in.
      const useDisplay = s.logoFont === 'display';
      const logoFont   = useDisplay ? 'var(--uc-heading-font)' : 'var(--uc-body-font)';
      const logoWeight = useDisplay ? 600 : 700;
      const logoSize   = s.logoSize || 18;
      const logoSpacing = useDisplay ? '.04em' : '.01em';
      const logoHtml = s.logoUrl
        ? `<img src="${s.logoUrl}" alt="${storeName}" style="height:${s.logoHeight||32}px;width:auto" onerror="this.style.display='none'">`
        : `<span style="font-family:${logoFont};font-weight:${logoWeight};font-size:${logoSize}px;letter-spacing:${logoSpacing}">${storeName}</span>`;

      const iconBtn = (label, svg, onclick) =>
        `<button type="button" aria-label="${label}" onclick="${onclick}" class="uc-header-icon" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;display:inline-flex;align-items:center;justify-content:center;position:relative">${svg}</button>`;

      const SVG = {
        search:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
        account:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        wishlist: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        cart:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        menu:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
      };

      const icons = [
        s.showSearchIcon   ? iconBtn('Search',   SVG.search,   "window.UC&&UC.focusSearch&&UC.focusSearch()") : '',
        s.showAccountIcon  ? iconBtn('Account',  SVG.account,  "window.location.href='/account'")          : '',
        s.showWishlistIcon ? iconBtn('Wishlist', SVG.wishlist, "window.location.href='/wishlist'")          : '',
        s.showCartIcon ? `<button type="button" aria-label="Cart" onclick="window.UC&&UC.openCart&&UC.openCart()" class="uc-header-icon" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;display:inline-flex;align-items:center;justify-content:center;position:relative">${SVG.cart}<span class="uc-cart-badge" data-uc-cart-badge style="position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:50%;background:var(--uc-primary);color:var(--uc-primary-text);font-size:10px;font-weight:600;display:none;align-items:center;justify-content:center;padding:0 4px">0</span></button>` : '',
      ].filter(Boolean).join('');

      const hamburger = s.showHamburger
        ? `<button type="button" aria-label="Menu" class="uc-header-hamburger" onclick="window.UC&&UC.openSidebar&&UC.openSidebar()" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;display:none;align-items:center">${SVG.menu}</button>`
        : '';

      return `<header class="uc-header" style="background:${s.backgroundColor||'var(--uc-bg)'};color:${s.textColor||'var(--uc-text)'};border-bottom:1px solid var(--uc-border);position:${s.sticky?'sticky':'relative'};top:0;z-index:80;">
        <div class="uc-container uc-w-contained" style="display:flex;align-items:center;gap:16px;height:${s.height||64}px">
          ${hamburger}
          <a href="/" style="display:inline-flex;align-items:center;gap:8px;color:inherit;text-decoration:none">${logoHtml}</a>
          <nav class="uc-header-links" style="display:flex;align-items:center;gap:${s.linkSpacing||24}px;margin-left:24px">${links}</nav>
          <div class="uc-header-icons" style="display:flex;align-items:center;gap:4px;margin-left:auto">${icons}</div>
        </div>
      </header>`;
    },

    'hero': (sec) => {
      const s = sec.settings;
      // Only render an <img>/<video> when the merchant actually supplied a URL.
      // The base theme falls back to the section's background color so an
      // unconfigured hero never shows a broken-image icon. The onerror handler
      // hides any image that fails to load (e.g. expired remote URL) so the
      // colored background still shows through cleanly.
      const mediaHtml = s.mediaType === 'video' && s.videoUrl
        ? `<video src="${s.videoUrl}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'"></video>`
        : s.imageUrl
          ? `<img src="${s.imageUrl}" alt="${s.imageAlt||''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'">`
          : '';
      const overlay = s.overlayOpacity > 0 ? `<div style="position:absolute;inset:0;background:${s.overlayColor||'#000'};opacity:${s.overlayOpacity||0};z-index:1"></div>` : '';
      const heading    = s.heading    || s.headline    || 'Welcome';
      const subheading = s.subheading || s.subheadline || '';
      const showSecondary = s.showSecondaryButton !== false;
      const btns = [s.primaryButton, showSecondary ? s.secondaryButton : null].filter(Boolean).map(renderButton).join(' ');
      const align = s.textAlign || (sec.layout && sec.layout.contentAlign) || 'center';
      return `<section class="uc-hero" style="position:relative;min-height:${s.minHeight||(sec.layout&&sec.layout.minHeight)||600}px;display:flex;align-items:${s.verticalAlign||'center'};overflow:hidden">
        ${mediaHtml}${overlay}
        <div class="uc-container uc-w-contained" style="position:relative;z-index:2;text-align:${align};max-width:${s.contentMaxWidth||'var(--uc-container-max)'}${typeof s.contentMaxWidth==='number'?'px':''}">
          ${s.eyebrow ? `<p style="text-transform:uppercase;letter-spacing:.1em;font-size:13px;margin-bottom:12px;color:var(--uc-accent)">${s.eyebrow}</p>` : ''}
          <h1 style="font-size:clamp(2rem,5vw,${s.headingSize||64}px);font-weight:var(--uc-heading-weight);color:${s.headingColor||'inherit'};margin:0 0 16px">${heading}</h1>
          ${subheading ? `<p style="font-size:${s.subheadingSize||20}px;margin-bottom:32px;opacity:.9;color:${s.subheadingColor||'inherit'}">${subheading}</p>` : ''}
          ${btns ? `<div style="display:flex;gap:12px;justify-content:${align};flex-wrap:wrap">${btns}</div>` : ''}
        </div>
      </section>`;
    },

    'product-grid': (sec) => {
      const s = sec.settings;
      return `<section class="uc-product-grid">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          <div class="uc-product-grid-items" data-cols="${s.columns||4}" data-limit="${s.limit||8}" data-collection="${s.collection||''}">
            <p style="color:var(--uc-text-muted);font-size:14px">Products loading…</p>
          </div>`, sec.layout)}
      </section>`;
    },

    'product-carousel': (sec) => {
      const s = sec.settings;
      return `<section class="uc-product-carousel">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          <div class="uc-carousel" data-collection="${s.collection||''}" data-limit="${s.limit||8}">
            <p style="color:var(--uc-text-muted);font-size:14px">Products loading…</p>
          </div>`, sec.layout)}
      </section>`;
    },

    /* Filterable shop grid: sidebar with category/price/size filters on the
       left, toolbar (search/sort/grid-list toggle) above a product grid on
       the right. Loads live products on mount via UC.loadFilterGrid and
       hooks Add-to-Bag into the global cart drawer. */
    'filter-product-grid': (sec) => {
      const s = sec.settings || {};
      const showFilters    = s.showFilters    !== false;
      const showSearch     = s.showSearch     !== false;
      const showSort       = s.showSort       !== false;
      const showViewToggle = s.showViewToggle !== false;
      const showATC        = s.showAddToCart  !== false;
      const cols           = Math.min(Math.max(parseInt(s.columns, 10) || 4, 2), 5);
      const cats           = Array.isArray(s.categories) ? s.categories : [];
      const sizes          = Array.isArray(s.sizes)      ? s.sizes      : [];
      const collection     = s.collection || '';
      const limit          = parseInt(s.limit, 10) || 48;
      const defaultView    = s.defaultView === 'list' ? 'list' : 'grid';

      const filtersHtml = !showFilters ? '' : `
        <aside class="uc-shop-sidebar" data-uc-sidebar>
          ${cats.length ? `
            <div class="uc-filter-group">
              <div class="uc-filter-label">Category</div>
              ${cats.map((c, i) => `
                <label class="uc-filter-option">
                  <input type="${i === 0 ? 'radio' : 'radio'}" name="uc-filter-cat" value="${c}"${i === 0 ? ' checked' : ''} onchange="window.UC&&UC.applyFilters&&UC.applyFilters(this)">
                  <span>${c}</span>
                </label>
              `).join('')}
            </div>
          ` : ''}
          <div class="uc-filter-group">
            <div class="uc-filter-label">Price</div>
            <div class="uc-price-range">
              <input type="number" class="uc-price-input" data-uc-price-min placeholder="Min" value="${s.priceMin||''}" oninput="window.UC&&UC.applyFilters&&UC.applyFilters(this)">
              <span>–</span>
              <input type="number" class="uc-price-input" data-uc-price-max placeholder="Max" value="${s.priceMax||''}" oninput="window.UC&&UC.applyFilters&&UC.applyFilters(this)">
            </div>
          </div>
          ${sizes.length ? `
            <div class="uc-filter-group">
              <div class="uc-filter-label">Size</div>
              <div class="uc-size-row">
                ${sizes.map(z => `
                  <button type="button" class="uc-size-btn" data-uc-size="${z}" onclick="window.UC&&UC.toggleSize&&UC.toggleSize(this)">${z}</button>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <button type="button" class="uc-sidebar-close" onclick="window.UC&&UC.closeSidebar&&UC.closeSidebar()" aria-label="Close filters">×</button>
        </aside>`;

      const toolbarHtml = `
        <div class="uc-shop-toolbar">
          <button type="button" class="uc-filter-toggle" onclick="window.UC&&UC.openSidebar&&UC.openSidebar()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>
            Filters
          </button>
          <span class="uc-result-count"><strong data-uc-count>0</strong> products</span>
          <div class="uc-shop-tools">
            ${showSearch ? `
              <div class="uc-search-bar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input type="search" placeholder="Search products…" data-uc-search oninput="window.UC&&UC.applyFilters&&UC.applyFilters(this)">
              </div>
            ` : ''}
            ${showSort ? `
              <select class="uc-sort-select" data-uc-sort onchange="window.UC&&UC.applyFilters&&UC.applyFilters(this)">
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name">Name A–Z</option>
              </select>
            ` : ''}
            ${showViewToggle ? `
              <div class="uc-view-toggle">
                <button type="button" data-uc-view="grid" class="${defaultView==='grid'?'active':''}" onclick="window.UC&&UC.setView&&UC.setView(this,'grid')" aria-label="Grid view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
                <button type="button" data-uc-view="list" class="${defaultView==='list'?'active':''}" onclick="window.UC&&UC.setView&&UC.setView(this,'list')" aria-label="List view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
                </button>
              </div>
            ` : ''}
          </div>
        </div>`;

      return `<section class="uc-filter-shop"
        data-uc-filter-shop
        data-uc-collection="${collection}"
        data-uc-limit="${limit}"
        data-uc-cols="${cols}"
        data-uc-show-atc="${showATC ? '1' : '0'}"
        data-uc-default-view="${defaultView}">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title" style="margin-bottom:24px">${s.heading}</h2>` : ''}
          <div class="uc-shop-layout">
            ${filtersHtml}
            <div class="uc-shop-main">
              ${toolbarHtml}
              <div class="uc-shop-grid uc-view-${defaultView}" data-uc-grid style="--uc-shop-cols:${cols}">
                <p class="uc-shop-state" data-uc-state>Loading products…</p>
              </div>
            </div>
          </div>
        `, sec.layout || {})}
      </section>`;
    },

    'gallery': (sec) => {
      const s = sec.settings;
      const items = (sec.blocks || []).filter(b => (b.type === 'gallery-image' || b.type === 'gallery-item') && b.visible !== false)
        .map(b => `<div class="uc-gallery-item" style="overflow:hidden;border-radius:var(--uc-card-radius)">
          <img src="${b.settings.url||b.settings.imageUrl||''}" alt="${b.settings.alt||''}" loading="lazy"
            style="width:100%;height:${s.imageHeight||280}px;object-fit:cover;transition:transform .3s"
            onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
          ${b.settings.caption ? `<p style="padding:8px 0;font-size:13px;color:var(--uc-text-muted)">${b.settings.caption}</p>` : ''}
        </div>`).join('');
      return `<section class="uc-gallery">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          <div style="display:grid;grid-template-columns:repeat(${s.columns||3},1fr);gap:var(--uc-gap)">${items || ''}</div>`, sec.layout)}
      </section>`;
    },

    'testimonials': (sec) => {
      const s = sec.settings;
      const items = (sec.blocks || []).filter(b => b.type === 'testimonial' && b.visible !== false)
        .map(b => `<div style="background:var(--uc-surface);padding:24px;border-radius:var(--uc-card-radius);border:1px solid var(--uc-border)">
          ${s.showRating !== false ? `<div style="color:var(--uc-accent);font-size:20px;margin-bottom:8px">${'★'.repeat(b.settings.rating||5)}</div>` : ''}
          <p style="font-size:15px;line-height:1.6;margin-bottom:16px">${b.settings.quote||b.settings.text||''}</p>
          <div style="display:flex;align-items:center;gap:12px">
            ${s.showAvatar !== false && b.settings.avatarUrl ? `<img src="${b.settings.avatarUrl}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : ''}
            <div><p style="font-weight:600;font-size:13px">${b.settings.author||''}</p>
            <p style="font-size:12px;color:var(--uc-text-muted)">${b.settings.role||''}</p></div>
          </div>
        </div>`).join('');
      return `<section class="uc-testimonials">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--uc-gap)">${items||''}</div>`, sec.layout)}
      </section>`;
    },

    'info': (sec) => {
      const s = sec.settings;
      const imageSrc = s.image || s.imageUrl;
      const imgStyle = `width:100%;border-radius:${s.imageRadius!=null?s.imageRadius+'px':'var(--uc-card-radius)'};${s.imageShadow?'box-shadow:0 8px 24px rgba(0,0,0,.15);':''}`;
      const imgHtml = imageSrc ? `<img src="${imageSrc}" alt="${s.imageAlt||''}" style="${imgStyle}">` : '';
      const button = s.ctaButton || s.button;
      const showCta = s.showCta !== false;
      const textBlock = `<div>
        ${s.eyebrow ? `<p style="text-transform:uppercase;letter-spacing:.1em;font-size:12px;color:var(--uc-accent);margin-bottom:8px">${s.eyebrow}</p>` : ''}
        <h2 style="font-size:${s.headingSize||36}px;font-weight:var(--uc-heading-weight);margin-bottom:16px">${s.heading||''}</h2>
        <div style="font-size:${s.bodySize||16}px;line-height:1.7;color:var(--uc-text-muted);margin-bottom:24px">${s.body||''}</div>
        ${showCta && button ? renderButton(button) : ''}
      </div>`;
      // Registry uses `layout` setting: 'image-right' | 'image-left' | 'image-top'.
      // Older renderer used `imagePosition`. Support both.
      const layoutKey = s.imagePosition || s.layout || 'image-right';
      const stack = layoutKey === 'image-top';
      const imgOrder = layoutKey === 'image-left' ? 'order:-1' : '';
      const cols = stack ? '1fr' : 'repeat(auto-fit,minmax(300px,1fr))';
      return `<section class="uc-info">
        ${wrapContainer(`<div style="display:grid;grid-template-columns:${cols};gap:48px;align-items:center">
          <div style="${imgOrder}">${imgHtml}</div>
          ${textBlock}
        </div>`, sec.layout)}
      </section>`;
    },

    'features': (sec) => {
      const s = sec.settings;
      const cardBg = s.cardStyle === 'plain' ? 'transparent'
                   : s.cardStyle === 'filled' ? 'var(--uc-surface)' : 'var(--uc-surface)';
      const cardBorder = s.cardStyle === 'bordered' ? '1px solid var(--uc-border)' : 'none';
      const cardShadow = s.cardStyle === 'shadow' ? 'box-shadow:0 4px 12px rgba(0,0,0,.08);' : '';
      const items = (sec.blocks || []).filter(b => b.type === 'feature' && b.visible !== false)
        .map(b => {
          // Registry block uses `icon` (Lucide name string), `heading`, `description`.
          // Older renderer used `iconUrl`/`emoji` and `title`. Support both.
          const iconHtml = b.settings.iconUrl
            ? `<img src="${b.settings.iconUrl}" alt="" style="width:${s.iconSize||40}px;height:${s.iconSize||40}px;margin-bottom:12px">`
            : b.settings.emoji
            ? `<div style="font-size:${s.iconSize||36}px;margin-bottom:12px">${b.settings.emoji}</div>`
            : b.settings.icon
            ? `<div style="font-size:${(s.iconSize||40)*0.6}px;color:${s.iconColor||'var(--uc-accent)'};margin-bottom:12px;font-weight:600">${b.settings.icon}</div>`
            : '';
          const heading = b.settings.heading || b.settings.title || '';
          return `<div style="text-align:${s.cardAlign||'left'};padding:${s.cardPadding||24}px;background:${cardBg};border-radius:var(--uc-card-radius);border:${cardBorder};${cardShadow}">
            ${iconHtml}
            <h3 style="font-size:${s.titleSize||18}px;font-weight:600;margin-bottom:8px">${heading}</h3>
            <p style="font-size:${s.bodySize||14}px;line-height:1.6;color:var(--uc-text-muted)">${b.settings.description||''}</p>
          </div>`;
        }).join('');
      return `<section class="uc-features">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          ${s.subheading ? `<p class="uc-section-sub">${s.subheading}</p>` : ''}
          <div style="display:grid;grid-template-columns:repeat(${s.columns||'auto-fit'},${s.columns?'1fr':'minmax(220px,1fr)'});gap:var(--uc-gap)">${items||''}</div>`, sec.layout)}
      </section>`;
    },

    'categories': (sec) => {
      const s = sec.settings;
      const items = (sec.blocks || []).filter(b => b.type === 'category-card' && b.visible !== false)
        .map(b => {
          // Registry uses `name` and `linkUrl`; older renderer used `label` and `url`.
          const label = b.settings.name || b.settings.label || '';
          const link  = b.settings.linkUrl || b.settings.url || '#';
          return `<a href="${link}" style="display:block;border-radius:${s.imageRadius!=null?s.imageRadius+'px':'var(--uc-card-radius)'};overflow:hidden;position:relative;text-decoration:none">
            <img src="${b.settings.imageUrl||''}" alt="${label}" loading="lazy"
              style="width:100%;height:${s.cardHeight||240}px;object-fit:cover;display:block">
            ${s.overlayStyle !== 'none' ? `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),transparent);display:flex;align-items:flex-end;padding:16px">
              <span style="color:#fff;font-weight:600;font-size:${s.labelSize||16}px">${label}</span>
            </div>` : `<div style="padding:12px"><span style="color:var(--uc-text);font-weight:600;font-size:${s.labelSize||16}px">${label}</span></div>`}
          </a>`;
        }).join('');
      return `<section class="uc-categories">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          <div style="display:grid;grid-template-columns:repeat(${s.columns||3},1fr);gap:var(--uc-gap)">${items||''}</div>`, sec.layout)}
      </section>`;
    },

    'newsletter': (sec) => {
      const s = sec.settings;
      // Registry uses `description` and `buttonText`; older renderer used `subheading` and `buttonLabel`.
      const description = s.description || s.subheading || '';
      const buttonText  = s.buttonText  || s.buttonLabel || 'Subscribe';
      const inputRadius = s.inputRadius != null ? s.inputRadius + 'px' : 'var(--uc-radius)';
      return `<section class="uc-newsletter">
        ${wrapContainer(`<div style="text-align:center;max-width:560px;margin:0 auto">
          ${s.heading ? `<h2 style="font-size:${s.headingSize||32}px;font-weight:var(--uc-heading-weight);margin-bottom:12px">${s.heading}</h2>` : ''}
          ${description ? `<p style="font-size:16px;color:var(--uc-text-muted);margin-bottom:24px">${description}</p>` : ''}
          <form onsubmit="return false" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
            <input type="email" placeholder="${s.placeholder||'Enter your email'}"
              style="flex:1;min-width:200px;padding:12px 16px;border:1px solid var(--uc-border);border-radius:${inputRadius};background:var(--uc-surface);color:var(--uc-text);font-size:14px;outline:none">
            <button type="submit" style="padding:12px 24px;background:var(--uc-primary);color:var(--uc-primary-text);border:none;border-radius:${inputRadius};font-weight:600;cursor:pointer;font-size:14px">${buttonText}</button>
          </form>
          ${s.disclaimer ? `<p style="font-size:12px;color:var(--uc-text-muted);margin-top:12px">${s.disclaimer}</p>` : ''}
        </div>`, sec.layout)}
      </section>`;
    },

    'faq': (sec) => {
      const s = sec.settings;
      const dividerColor = s.dividerColor || 'var(--uc-border)';
      const defaultOpen  = typeof s.defaultOpen === 'number' ? s.defaultOpen : -1;
      const items = (sec.blocks || []).filter(b => b.type === 'faq-item' && b.visible !== false)
        .map((b, i) => `<details${i === defaultOpen ? ' open' : ''} style="border-bottom:1px solid ${dividerColor};padding:16px 0">
          <summary style="font-weight:600;font-size:${s.questionSize||16}px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center">
            ${b.settings.question||''}<span>+</span>
          </summary>
          <div style="margin-top:12px;font-size:${s.answerSize||15}px;line-height:1.7;color:var(--uc-text-muted)">${b.settings.answer||''}</div>
        </details>`).join('');
      return `<section class="uc-faq">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          ${s.subheading ? `<p class="uc-section-sub">${s.subheading}</p>` : ''}
          <div style="max-width:720px;margin:0 auto">${items||''}</div>`, sec.layout)}
      </section>`;
    },

    'rich-text': (sec) => {
      const s = sec.settings;
      return `<section class="uc-rich-text">
        ${wrapContainer(`<div class="uc-prose" style="max-width:${s.maxWidth||720}px;margin:0 auto">${s.content||''}</div>`, sec.layout)}
      </section>`;
    },

    'video': (sec) => {
      const s = sec.settings;
      const videoHtml = s.videoType === 'youtube'
        ? `<iframe src="https://www.youtube.com/embed/${extractYouTubeId(s.videoUrl||'')}" frameborder="0" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%"></iframe>`
        : s.videoType === 'vimeo'
        ? `<iframe src="https://player.vimeo.com/video/${extractVimeoId(s.videoUrl||'')}" frameborder="0" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%"></iframe>`
        : `<video src="${s.videoUrl||''}" controls ${s.autoplay?'autoplay':''} ${s.muted?'muted':''} ${s.loop?'loop':''} style="width:100%;display:block"></video>`;
      const wrapper = s.videoType !== 'file'
        ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:var(--uc-card-radius)">${videoHtml}</div>`
        : videoHtml;
      return `<section class="uc-video">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
          ${wrapper}`, sec.layout)}
      </section>`;
    },

    'spacer': (sec) => {
      const h = sec.settings.height || 80;
      return `<div class="uc-spacer" style="height:${h}px"></div>`;
    },

    'divider': (sec) => {
      const s = sec.settings;
      // Registry `width` is a percentage number (10-100); legacy callers may pass a CSS string.
      const width = typeof s.width === 'number' ? s.width + '%' : (s.width || '100%');
      return `<div class="uc-divider" style="padding:${s.paddingY||0}px 0">
        <hr style="border:none;border-top:${s.thickness||1}px ${s.style||'solid'} ${s.color||'var(--uc-border)'};width:${width};margin:0 auto">
      </div>`;
    },

    'footer': (sec) => {
      const s = sec.settings;
      const cols = (sec.blocks || []).filter(b => b.type === 'footer-column' && b.visible !== false)
        .map(b => {
          // Registry block stores `links` as an array of { label, url }.
          // Older renderer expected an HTML string in `content`. Support both.
          const linksHtml = Array.isArray(b.settings.links)
            ? b.settings.links.map(l => `<a href="${l.url||'#'}" style="color:inherit;text-decoration:none;display:block">${l.label||''}</a>`).join('')
            : (b.settings.content || '');
          return `<div>
            <h4 style="font-weight:600;margin-bottom:12px;font-size:14px">${b.settings.heading||''}</h4>
            <div style="font-size:13px;line-height:2;color:var(--uc-text-muted)">${linksHtml}</div>
          </div>`;
        }).join('');
      // About column from settings, if provided.
      const aboutCol = s.aboutText ? `<div>
        ${s.logoUrl ? `<img src="${s.logoUrl}" alt="" style="height:32px;margin-bottom:12px">` : ''}
        <p style="font-size:13px;line-height:1.7;color:var(--uc-text-muted);max-width:280px">${s.aboutText}</p>
      </div>` : '';
      // Social icons.
      const social = s.showSocial && s.socialLinks ? Object.entries(s.socialLinks)
        .filter(([, url]) => !!url)
        .map(([k, url]) => `<a href="${url}" target="_blank" rel="noreferrer" aria-label="${k}" style="color:inherit;text-decoration:none;font-size:14px;text-transform:capitalize">${k}</a>`).join(' · ') : '';
      const copyright = s.copyrightText || s.copyright || '';
      return `<footer class="uc-footer" style="background:${s.backgroundColor||'var(--uc-surface)'};color:${s.textColor||'var(--uc-text)'}">
        <div class="uc-container uc-w-contained">
          ${(aboutCol || cols) ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:32px;margin-bottom:32px">${aboutCol}${cols}</div>` : ''}
          <div style="border-top:1px solid var(--uc-border);padding-top:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-size:12px;color:${s.copyrightColor||'var(--uc-text-muted)'}">
            <span>${copyright}</span>
            ${social ? `<span>${social}</span>` : (s.showPaymentIcons ? '<span>Payments placeholder</span>' : '')}
          </div>
        </div>
      </footer>`;
    },

    'custom': (sec) => {
      return `<div class="uc-custom">${sec.settings.html || sec.settings.htmlContent || ''}</div>`;
    },
  };

  // Alias: a `nav` section renders identically to a header. Prevents
  // "Unknown section type: nav" if a seeded schema or user input uses `nav`.
  RENDERERS['nav'] = RENDERERS['header'];

  function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
    return m ? m[1] : '';
  }
  function extractVimeoId(url) {
    const m = url.match(/vimeo\.com\/(\d+)/);
    return m ? m[1] : '';
  }

  /* ── Shop CSS (filter-product-grid + global cart drawer + modal) ─────── */
  // Bundled into the main theme stylesheet so the shop UI inherits the active
  // theme variables. The overlay sits *below* the sidebar/cart-drawer/modal
  // z-indices on purpose: the backdrop blurs the page behind those panels but
  // never the panels themselves — that was the bug in the prior demo, where a
  // single overlay z-index above the sidebar caused the filter sidebar itself
  // to render blurred.
  const SHOP_CSS = `
    /* ── Header chrome ───────────────────────────────────────────── */
    .uc-header-icon { transition: opacity .15s; }
    .uc-header-icon:hover { opacity: .65; }
    @media (max-width: 768px) {
      .uc-header-links { display: none !important; }
      .uc-header-hamburger { display: inline-flex !important; }
    }

    /* ── Backdrop / overlay ──────────────────────────────────────── */
    .uc-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 90;                           /* below sidebar/cart/modal */
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease;
    }
    .uc-overlay.is-active { opacity: 1; pointer-events: auto; }

    /* ── Filter sidebar ──────────────────────────────────────────── */
    .uc-shop-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 32px;
      align-items: start;
    }
    .uc-shop-layout.no-filters { grid-template-columns: 1fr; }
    @media (max-width: 900px) { .uc-shop-layout { grid-template-columns: 1fr; } }

    .uc-shop-sidebar {
      background: var(--uc-bg);
      border: 1px solid var(--uc-border);
      border-radius: var(--uc-card-radius);
      padding: 20px;
      position: sticky; top: 80px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      z-index: 1;
    }
    @media (max-width: 900px) {
      .uc-shop-sidebar {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        width: min(320px, 86vw);
        max-height: 100vh;
        border-radius: 0;
        z-index: 100;                        /* above .uc-overlay's 90 */
        transform: translateX(-100%);
        transition: transform .3s cubic-bezier(.16,1,.3,1);
        box-shadow: 0 0 40px rgba(0,0,0,0.15);
      }
      .uc-shop-sidebar.is-open { transform: translateX(0); }
    }
    .uc-sidebar-close {
      display: none;
      position: absolute; top: 12px; right: 12px;
      width: 32px; height: 32px;
      border: none; background: none;
      font-size: 22px; line-height: 1; cursor: pointer;
      color: var(--uc-text-muted);
    }
    @media (max-width: 900px) { .uc-sidebar-close { display: block; } }

    .uc-filter-group { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--uc-border); }
    .uc-filter-group:last-child { border-bottom: none; padding-bottom: 0; }
    .uc-filter-label {
      font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
      color: var(--uc-text-muted); margin-bottom: 12px; font-weight: 600;
    }
    .uc-filter-option {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 0; cursor: pointer; font-size: 13px;
    }
    .uc-filter-option input { accent-color: var(--uc-primary); }
    .uc-price-range { display: flex; align-items: center; gap: 8px; }
    .uc-price-input {
      flex: 1; min-width: 0;
      padding: 6px 10px;
      border: 1px solid var(--uc-border);
      background: var(--uc-bg); color: var(--uc-text);
      font: inherit; font-size: 13px;
      border-radius: var(--uc-radius);
    }
    .uc-size-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .uc-size-btn {
      padding: 6px 12px;
      border: 1px solid var(--uc-border);
      background: var(--uc-bg); color: var(--uc-text);
      font: inherit; font-size: 12px; cursor: pointer;
      border-radius: var(--uc-radius);
      transition: all .15s;
    }
    .uc-size-btn:hover { border-color: var(--uc-text); }
    .uc-size-btn.is-active { background: var(--uc-primary); color: var(--uc-primary-text); border-color: var(--uc-primary); }

    /* ── Toolbar ─────────────────────────────────────────────────── */
    .uc-shop-toolbar {
      display: flex; align-items: center;
      justify-content: space-between; gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--uc-border);
    }
    .uc-filter-toggle {
      display: none; align-items: center; gap: 6px;
      background: none; border: 1px solid var(--uc-border);
      padding: 8px 14px; border-radius: var(--uc-radius);
      font: inherit; font-size: 13px; cursor: pointer;
      color: var(--uc-text);
    }
    @media (max-width: 900px) { .uc-filter-toggle { display: inline-flex; } }
    .uc-result-count { color: var(--uc-text-muted); font-size: 13px; }
    .uc-result-count strong { color: var(--uc-text); }
    .uc-shop-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .uc-search-bar {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--uc-border);
      border-radius: var(--uc-radius);
      background: var(--uc-bg);
    }
    .uc-search-bar input {
      border: none; background: none; outline: none;
      font: inherit; font-size: 13px;
      color: var(--uc-text);
      width: 180px;
    }
    .uc-sort-select {
      border: 1px solid var(--uc-border); background: var(--uc-bg); color: var(--uc-text);
      padding: 7px 12px; font: inherit; font-size: 13px;
      border-radius: var(--uc-radius); cursor: pointer;
    }
    .uc-view-toggle { display: inline-flex; }
    .uc-view-toggle button {
      width: 32px; height: 32px;
      border: 1px solid var(--uc-border);
      background: var(--uc-bg); color: var(--uc-text-muted);
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    }
    .uc-view-toggle button:first-child { border-radius: var(--uc-radius) 0 0 var(--uc-radius); }
    .uc-view-toggle button:last-child  { border-radius: 0 var(--uc-radius) var(--uc-radius) 0; border-left: none; }
    .uc-view-toggle button.active { background: var(--uc-primary); color: var(--uc-primary-text); border-color: var(--uc-primary); }

    /* ── Product grid ────────────────────────────────────────────── */
    .uc-shop-grid.uc-view-grid {
      display: grid;
      grid-template-columns: repeat(var(--uc-shop-cols, 4), 1fr);
      gap: 16px;
    }
    @media (max-width: 900px) { .uc-shop-grid.uc-view-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 600px) { .uc-shop-grid.uc-view-grid { grid-template-columns: repeat(2, 1fr); } }
    .uc-shop-grid.uc-view-list { display: flex; flex-direction: column; gap: 12px; }
    .uc-shop-state { grid-column: 1/-1; padding: 60px 0; text-align: center; color: var(--uc-text-muted); font-size: 13px; }

    .uc-product-card {
      display: block; text-decoration: none; color: inherit;
      background: var(--uc-bg);
      border: 1px solid var(--uc-border);
      border-radius: var(--uc-card-radius);
      overflow: hidden;
      transition: transform .25s ease, border-color .2s;
      position: relative;
    }
    .uc-product-card:hover { border-color: var(--uc-text); }
    .uc-product-card:hover .uc-product-img img { transform: scale(1.04); }
    .uc-product-card:hover .uc-product-atc { opacity: 1; transform: translateY(0); }
    .uc-product-img {
      aspect-ratio: 3/4;
      background: var(--uc-surface);
      overflow: hidden;
      position: relative;
    }
    .uc-product-img img { width: 100%; height: 100%; object-fit: cover; transition: transform .35s ease; }
    .uc-product-info { padding: 12px 14px 16px; }
    .uc-product-name { font-size: 14px; font-weight: 500; margin-bottom: 4px; line-height: 1.3; }
    .uc-product-price { font-size: 13px; color: var(--uc-text-muted); }
    .uc-product-atc {
      position: absolute; left: 8px; right: 8px; bottom: 8px;
      padding: 9px 12px;
      background: var(--uc-primary); color: var(--uc-primary-text);
      border: none; cursor: pointer;
      font: inherit; font-size: 11px; font-weight: 600;
      letter-spacing: .08em; text-transform: uppercase;
      border-radius: var(--uc-radius);
      opacity: 0; transform: translateY(6px);
      transition: opacity .2s, transform .2s, background .15s;
    }
    .uc-product-atc:hover { background: var(--uc-text); }
    @media (hover: none) { .uc-product-atc { opacity: 1; transform: none; } }

    .uc-shop-grid.uc-view-list .uc-product-card { display: grid; grid-template-columns: 140px 1fr; }
    .uc-shop-grid.uc-view-list .uc-product-img { aspect-ratio: auto; height: 100%; }
    .uc-shop-grid.uc-view-list .uc-product-info { display: flex; flex-direction: column; justify-content: center; padding: 20px; }
    .uc-shop-grid.uc-view-list .uc-product-atc {
      position: static; margin-top: 12px; max-width: 180px;
      opacity: 1; transform: none;
    }

    /* ── Cart drawer (singleton) ────────────────────────────────── */
    .uc-cart-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(420px, 100vw);
      background: var(--uc-bg);
      border-left: 1px solid var(--uc-border);
      z-index: 110;
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .3s cubic-bezier(.16,1,.3,1);
      box-shadow: 0 0 40px rgba(0,0,0,0.15);
    }
    .uc-cart-drawer.is-open { transform: translateX(0); }
    .uc-cart-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 22px;
      border-bottom: 1px solid var(--uc-border);
    }
    .uc-cart-title { font-family: var(--uc-heading-font); font-size: 20px; font-weight: 600; }
    .uc-cart-close {
      width: 32px; height: 32px;
      border: none; background: none; cursor: pointer;
      color: var(--uc-text-muted); font-size: 22px; line-height: 1;
    }
    .uc-cart-items { flex: 1; overflow-y: auto; padding: 18px 22px; }
    .uc-cart-empty { text-align: center; color: var(--uc-text-muted); padding: 60px 0; font-size: 14px; }
    .uc-cart-item {
      display: grid; grid-template-columns: 64px 1fr; gap: 14px;
      padding: 14px 0; border-bottom: 1px solid var(--uc-border);
    }
    .uc-cart-item-img { width: 64px; height: 80px; object-fit: cover; background: var(--uc-surface); border-radius: var(--uc-radius); }
    .uc-cart-item-name { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
    .uc-cart-item-price { font-size: 12px; color: var(--uc-text-muted); margin-bottom: 8px; }
    .uc-cart-qty { display: inline-flex; align-items: center; border: 1px solid var(--uc-border); border-radius: var(--uc-radius); }
    .uc-cart-qty button {
      width: 28px; height: 28px; border: none; background: none;
      font: inherit; font-size: 14px; cursor: pointer; color: var(--uc-text);
    }
    .uc-cart-qty span { width: 28px; text-align: center; font-size: 13px; }
    .uc-cart-remove {
      background: none; border: none; cursor: pointer;
      font: inherit; font-size: 11px; color: var(--uc-text-muted);
      margin-top: 6px; text-decoration: underline;
    }
    .uc-cart-footer {
      padding: 18px 22px;
      border-top: 1px solid var(--uc-border);
      background: var(--uc-bg);
    }
    .uc-cart-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
    .uc-cart-subtotal { font-family: var(--uc-heading-font); font-size: 18px; font-weight: 600; }
    .uc-cart-checkout {
      display: block; width: 100%; padding: 14px;
      background: var(--uc-primary); color: var(--uc-primary-text);
      border: none; cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600;
      letter-spacing: .12em; text-transform: uppercase;
      border-radius: var(--uc-radius);
      text-align: center; text-decoration: none;
    }
    .uc-cart-checkout:disabled { opacity: .4; cursor: not-allowed; }

    /* ── Quick view modal ───────────────────────────────────────── */
    .uc-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      z-index: 120;
      display: none; align-items: center; justify-content: center;
      padding: 24px;
    }
    .uc-modal-overlay.is-open { display: flex; }
    .uc-modal {
      background: var(--uc-bg);
      border-radius: var(--uc-card-radius);
      width: 100%; max-width: 720px; max-height: 90vh;
      overflow: auto;
      display: grid; grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 700px) { .uc-modal { grid-template-columns: 1fr; } }
    .uc-modal-img { background: var(--uc-surface); aspect-ratio: 3/4; }
    .uc-modal-img img { width: 100%; height: 100%; object-fit: cover; }
    .uc-modal-body { padding: 28px 28px 24px; display: flex; flex-direction: column; }
    .uc-modal-close {
      align-self: flex-end;
      background: none; border: none; cursor: pointer;
      font-size: 22px; color: var(--uc-text-muted); line-height: 1;
    }
    .uc-modal-name { font-family: var(--uc-heading-font); font-size: 22px; font-weight: 600; margin: 8px 0 6px; }
    .uc-modal-price { font-size: 16px; margin-bottom: 14px; }
    .uc-modal-desc { font-size: 13px; line-height: 1.7; color: var(--uc-text-muted); margin-bottom: 20px; flex: 1; }
    .uc-modal-atc {
      padding: 14px;
      background: var(--uc-primary); color: var(--uc-primary-text);
      border: none; cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600;
      letter-spacing: .12em; text-transform: uppercase;
      border-radius: var(--uc-radius);
    }
  `;

  /* ── Main render ──────────────────────────────────────────────────────── */

  let currentSchema = null;
  let styleEl = null;
  let mainEl  = null;

  /* ── ARCH theme slot patchers ──────────────────────────────────────────
     The base storefront template (customer-store/index.html) ships with
     pre-built ARCH-styled markup for the four "core" section types
     (header, hero, footer, product-grid). When the editor saves a schema,
     we patch the existing DOM in-place instead of replacing it, so the
     rich CSS / interactions keep working. Section types without an ARCH
     slot fall through to the legacy RENDERERS map below and get appended
     to #uc-extra-sections. */

  // Set element text only when it actually changed — prevents the layout
  // from flickering on every postMessage during typing.
  function setText(el, value) {
    if (!el) return;
    var v = value == null ? '' : String(value);
    if (el.textContent !== v) el.textContent = v;
  }

  function setAttr(el, attr, value) {
    if (!el) return;
    if (value == null || value === '') el.removeAttribute(attr);
    else if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible === false ? 'none' : '';
  }

  // ── header (data-uc-section="header") ──
  function patchHeader(sec) {
    var root = document.querySelector('[data-uc-section="header"]');
    if (!root) return;
    var s = sec.settings || {};
    setVisible(root, sec.visible !== false);

    // Logo / store name — both in the nav and the footer
    var name = s.storeName || s.logo || 'Store';
    document.querySelectorAll('[data-store-name]').forEach(function (n) { setText(n, name); });

    // Optional nav links (settings.navLinks: Array<{label, url}>). When
    // provided, the left list is the first half and the right list is
    // the rest — keeps the centered logo balanced.
    if (Array.isArray(s.navLinks)) {
      var leftHost  = root.querySelector('[data-uc-bind="header.navLinks.left"]');
      var rightHost = root.querySelector('[data-uc-bind="header.navLinks.right"]');
      var mid = Math.ceil(s.navLinks.length / 2);
      var leftLinks  = s.navLinks.slice(0, mid);
      var rightLinks = s.navLinks.slice(mid);
      var renderLink = function (l) {
        return '<a href="' + (l.url || '#') + '" class="nav-link">' + escapeHtml(l.label || '') + '</a>';
      };
      if (leftHost)  leftHost.innerHTML  = leftLinks.map(renderLink).join('');
      if (rightHost) rightHost.innerHTML = rightLinks.map(renderLink).join('');
    }

    // Cart icon visibility
    var cartBtn = root.querySelector('[data-uc-bind="header.cartIcon"]');
    if (cartBtn && s.showCartIcon === false) cartBtn.style.display = 'none';
    else if (cartBtn) cartBtn.style.display = '';
  }

  // ── hero (data-uc-section="hero") ──
  function patchHero(sec) {
    var root = document.querySelector('[data-uc-section="hero"]');
    if (!root) return;
    var s = sec.settings || {};
    setVisible(root, sec.visible !== false);

    // Kicker / subhead
    var kicker = root.querySelector('[data-uc-bind="hero.kicker"]');
    setText(kicker, s.subheadline || s.subheading || s.kicker || 'New Season Arrivals');

    // Headline — split on a period or use accent setting
    var titleMain   = root.querySelector('[data-uc-bind="hero.titleMain"]');
    var titleAccent = root.querySelector('[data-uc-bind="hero.titleAccent"]');
    var rawTitle    = s.headline || s.heading || '';
    if (s.titleAccent) {
      setText(titleMain, s.titleMain || rawTitle);
      setText(titleAccent, s.titleAccent);
    } else if (rawTitle.indexOf('.') !== -1) {
      var idx = rawTitle.indexOf('.');
      setText(titleMain, rawTitle.slice(0, idx).trim());
      setText(titleAccent, rawTitle.slice(idx).trim());
    } else {
      setText(titleMain, rawTitle);
      setText(titleAccent, '');
    }

    // CTA button
    var ctaWrap  = root.querySelector('[data-uc-bind="hero.cta"]');
    var ctaLabel = ctaWrap && ctaWrap.querySelector('span');
    var btn = s.primaryButton || s.cta || {};
    setText(ctaLabel, btn.label || btn.text || s.ctaLabel || 'Shop Now');
    if (ctaWrap) setAttr(ctaWrap, 'href', btn.url || s.ctaUrl || '/products');

    // Hero image
    var img = root.querySelector('[data-uc-bind="hero.image"]');
    if (img && s.image) setAttr(img, 'src', s.image);

    // Season marker (small vertical text on right edge)
    var heroText = root.querySelector('[data-uc-bind="hero.text"]');
    if (heroText && s.season) setAttr(heroText, 'data-season', s.season);

    // Stats strip — Array<{value, label}>; hide if empty array provided
    if (Array.isArray(s.stats)) {
      var statsHost = root.querySelector('[data-uc-bind="hero.stats"]');
      if (statsHost) {
        if (!s.stats.length) statsHost.style.display = 'none';
        else {
          statsHost.style.display = '';
          statsHost.innerHTML = s.stats.map(function (st) {
            return '<div class="hero-stat"><strong>' + escapeHtml(st.value || '') + '</strong>' + escapeHtml(st.label || '') + '</div>';
          }).join('');
        }
      }
    }
  }

  // ── footer (data-uc-section="footer") ──
  function patchFooter(sec) {
    var root = document.querySelector('[data-uc-section="footer"]');
    if (!root) return;
    var s = sec.settings || {};
    setVisible(root, sec.visible !== false);

    // Tagline / about
    var tagline = root.querySelector('[data-uc-bind="footer.tagline"]');
    setText(tagline, s.aboutText || s.tagline || s.description || '');

    // Copyright (preserve store-name span if present in the original copy)
    var copy = root.querySelector('[data-uc-bind="footer.copyright"]');
    if (copy && (s.copyrightText || s.copyright)) {
      copy.textContent = s.copyrightText || s.copyright;
    }

    // Footer columns from blocks (footer-column blocks). Each block has
    // settings.title and settings.links: Array<{label, url}>.
    var blocks = (sec.blocks || []).filter(function (b) {
      return b.visible !== false && b.type === 'footer-column';
    });
    if (blocks.length) {
      // Map columns 1..3 (the first column is reserved for logo + tagline).
      blocks.slice(0, 3).forEach(function (b, i) {
        var col = root.querySelector('[data-uc-bind="footer.col' + (i + 1) + '"]');
        if (!col) return;
        var bs = b.settings || {};
        var links = Array.isArray(bs.links) ? bs.links : [];
        col.innerHTML =
          '<div class="footer-col-title">' + escapeHtml(bs.title || '') + '</div>' +
          '<div class="footer-links">' +
            links.map(function (l) {
              return '<a class="footer-link" href="' + (l.url || '#') + '">' + escapeHtml(l.label || '') + '</a>';
            }).join('') +
          '</div>';
      });
    }
  }

  // ── product-grid (data-uc-section="product-grid") ──
  function patchProductGrid(sec) {
    var root = document.querySelector('[data-uc-section="product-grid"]');
    if (!root) return;
    setVisible(root, sec.visible !== false);
    // Heading / sort defaults / pagination tuning belongs here when wired.
    // Today the storefront's inline JS handles all data + UI for the grid.
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Map of section type → patcher. Sections not listed here fall through
  // to the legacy RENDERERS path and get appended to #uc-extra-sections.
  var ARCH_PATCHERS = {
    'header':       patchHeader,
    'nav':          patchHeader,
    'hero':         patchHero,
    'footer':       patchFooter,
    'product-grid': patchProductGrid,
  };

  function applySchema(schema) {
    currentSchema = schema;

    // ── Global CSS vars (editor theme presets — co-exist with ARCH's
    //     own --bg/--ink/--accent in index.html). ──
    var theme = schema && schema.globalTheme;
    if (theme && theme.colors && theme.typography && theme.spacing) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'uc-theme-vars';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent =
        ':root { ' + themeToCssVars(theme) + ' }\n' +
        (theme.customCSS || '');
      if (theme.typography.headingFont) loadGoogleFont(theme.typography.headingFont);
      if (theme.typography.bodyFont)    loadGoogleFont(theme.typography.bodyFont);
    }

    if (!schema || !schema.pages) return;
    var pageId = Object.keys(schema.pages)[0] || 'index';
    var page   = schema.pages[pageId];
    if (!page || !Array.isArray(page.sections)) return;

    // ── Pass 1: patch ARCH slots in declaration order. ──
    // ── Pass 2: render any sections without an ARCH slot into the
    //     #uc-extra-sections container, in their schema order. ──
    var extras = [];
    page.sections.forEach(function (sec) {
      if (!sec || sec.visible === false) return;
      var patcher = ARCH_PATCHERS[sec.type];
      if (patcher) {
        try { patcher(sec); }
        catch (e) { console.error('Patch failed for ' + sec.type + ':', e); }
      } else {
        extras.push(sec);
      }
    });

    var extrasEl = document.getElementById('uc-extra-sections');
    if (!extrasEl) {
      // Standalone preview / legacy index: build a canvas if nothing exists.
      extrasEl = document.getElementById('uc-editor-canvas');
      if (!extrasEl) {
        extrasEl = document.createElement('div');
        extrasEl.id = 'uc-editor-canvas';
        document.body.appendChild(extrasEl);
      }
    }
    if (mainEl !== extrasEl) mainEl = extrasEl;

    extrasEl.innerHTML = extras.map(function (sec) {
      var renderer = RENDERERS[sec.type];
      if (!renderer) return '<!-- Unknown section type: ' + sec.type + ' -->';

      var layout = sec.layout || {};
      var parts  = [
        layout.background ? bgToCss(layout.background)         : '',
        layout.padding    ? spacingToCss(layout.padding, 'padding') : '',
        layout.margin     ? spacingToCss(layout.margin,  'margin')  : '',
        layout.minHeight  ? 'min-height:' + layout.minHeight + 'px;' : '',
      ].filter(Boolean).join(' ');

      var inner     = renderer(sec);
      var customCSS = sec.customCSS
        ? '<style>[data-sec="' + sec.id + '"] { ' + sec.customCSS + ' }</style>'
        : '';
      return '<div data-sec="' + sec.id + '" data-type="' + sec.type + '" style="' + parts.replace(/\n/g, ' ') + '">' + customCSS + inner + '</div>';
    }).join('\n');
  }

  function readShopFiltersFromDom(root) {
    const filters = {};
    const search  = root.querySelector('[data-uc-search]');
    const sort    = root.querySelector('[data-uc-sort]');
    const minIn   = root.querySelector('[data-uc-price-min]');
    const maxIn   = root.querySelector('[data-uc-price-max]');
    if (search && search.value) filters.search = search.value.trim();
    if (sort && sort.value)     filters.sort   = sort.value;
    if (minIn && minIn.value !== '') filters.priceMin = Number(minIn.value);
    if (maxIn && maxIn.value !== '') filters.priceMax = Number(maxIn.value);
    return filters;
  }

  /* ── Public window.UC API (referenced from inline event handlers) ───── */

  const UC = window.UC = window.UC || {};

  UC.openCart = function () {
    const drawer = document.getElementById('uc-cart-drawer');
    const overlay = document.getElementById('uc-overlay');
    if (drawer)  drawer.classList.add('is-open');
    if (overlay) overlay.classList.add('is-active');
    syncCartUI();
  };
  UC.closeCart = function () {
    const drawer = document.getElementById('uc-cart-drawer');
    if (drawer) drawer.classList.remove('is-open');
    UC.maybeCloseOverlay();
  };
  UC.openSidebar = function () {
    document.querySelectorAll('[data-uc-sidebar]').forEach(s => s.classList.add('is-open'));
    const overlay = document.getElementById('uc-overlay');
    if (overlay) overlay.classList.add('is-active');
  };
  UC.closeSidebar = function () {
    document.querySelectorAll('[data-uc-sidebar]').forEach(s => s.classList.remove('is-open'));
    UC.maybeCloseOverlay();
  };
  UC.maybeCloseOverlay = function () {
    const drawer  = document.getElementById('uc-cart-drawer');
    const sbOpen  = document.querySelector('[data-uc-sidebar].is-open');
    const drawerOpen = drawer && drawer.classList.contains('is-open');
    if (!sbOpen && !drawerOpen) {
      const overlay = document.getElementById('uc-overlay');
      if (overlay) overlay.classList.remove('is-active');
    }
  };
  UC.closeAll = function () {
    UC.closeCart();
    UC.closeSidebar();
  };
  UC.focusSearch = function () {
    const input = document.querySelector('[data-uc-search]');
    if (input) { input.focus(); input.select && input.select(); }
  };

  UC.applyFilters = function (sourceEl) {
    const root = sourceEl && sourceEl.closest && sourceEl.closest('[data-uc-filter-shop]');
    if (!root) return;
    const sectionId = root.closest('[data-sec]') ? root.closest('[data-sec]').getAttribute('data-sec') : root.id;
    const state = SHOP_STATE[sectionId];
    if (!state) return;
    state.filters = readShopFiltersFromDom(root);
    renderShopGrid(root, sectionId);
  };

  UC.toggleSize = function (btn) {
    btn.classList.toggle('is-active');
    UC.applyFilters(btn);
  };

  UC.setView = function (btn, view) {
    const root = btn.closest('[data-uc-filter-shop]');
    if (!root) return;
    const sectionId = root.closest('[data-sec]') ? root.closest('[data-sec]').getAttribute('data-sec') : root.id;
    const state = SHOP_STATE[sectionId];
    if (!state) return;
    state.view = view === 'list' ? 'list' : 'grid';
    root.querySelectorAll('[data-uc-view]').forEach(b => b.classList.toggle('active', b === btn));
    renderShopGrid(root, sectionId);
  };

  UC.addProductToCart = function (productId) {
    const p = findProductById(productId);
    if (!p) return;
    if (typeof window.addToCart === 'function') window.addToCart(p, 1);
    UC.openCart();
  };

  UC.changeQty = function (productId, delta) {
    if (typeof window.getCart !== 'function' || typeof window.setQuantity !== 'function') return;
    const item = window.getCart().find(i => String(i.productId) === String(productId));
    if (!item) return;
    window.setQuantity(productId, item.quantity + delta);
  };

  UC.removeItem = function (productId) {
    if (typeof window.removeFromCart === 'function') window.removeFromCart(productId);
  };

  UC.openQuickView = function (productId) {
    const p = findProductById(productId);
    if (!p) return;
    const modal = document.getElementById('uc-quick-view');
    if (!modal) return;
    const img = (p.images && p.images[0]) || '';
    modal.querySelector('[data-uc-qv-img]').innerHTML = img
      ? `<img src="${img}" alt="${(p.name||'').replace(/"/g,'&quot;')}" onerror="this.style.display='none'">`
      : '';
    modal.querySelector('[data-uc-qv-name]').textContent = p.name || '';
    modal.querySelector('[data-uc-qv-price]').textContent = typeof window.formatPrice === 'function'
      ? window.formatPrice(p.price, p.currency)
      : '$' + (p.price / 100).toFixed(2);
    modal.querySelector('[data-uc-qv-desc]').textContent = p.description || '';
    const atc = modal.querySelector('[data-uc-qv-atc]');
    atc.onclick = function () {
      UC.addProductToCart(productId);
      UC.closeQuickView();
    };
    modal.classList.add('is-open');
  };
  UC.closeQuickView = function () {
    const modal = document.getElementById('uc-quick-view');
    if (modal) modal.classList.remove('is-open');
  };

  // ESC closes everything
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      UC.closeAll();
      UC.closeQuickView();
    }
  });

  /* ── postMessage bridge ───────────────────────────────────────────────── */

  window.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'bst:schema' && d.schema) {
      applySchema(d.schema);
    }

    // Legacy compat: bst:preview with _themeVars
    if (d.type === 'bst:preview' && d.settings && d.settings._themeVars) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'uc-theme-vars';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = d.settings._themeVars;
    }
  });

  // Signal ready to parent
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'bst:ready' }, '*');
  }

  // Standalone (non-editor) load: pull the saved schema from the public
  // settings endpoint and render it. Editor mode (parent !== window) is
  // already handled via the `bst:schema` postMessage above, so this branch
  // only runs for real customers visiting the storefront directly.
  if (window.parent === window) {
    var apiBase = window.BST_API_BASE || '';
    fetch(apiBase + '/settings/public', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        var raw = body && body.ok && body.data && body.data.page_sections;
        if (!raw) return;
        try { applySchema(JSON.parse(raw)); }
        catch (e) { console.error('Bad page_sections JSON:', e); }
      })
      .catch(function () { /* network error: leave canvas empty */ });
  }

})();
