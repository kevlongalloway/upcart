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
      // ARCH puts a couple of "About" / utility links on the right side; if a
      // merchant doesn't supply navLinksRight we fall back to none and use
      // navLinks on the left.
      const rightLinks = Array.isArray(s.navLinksRight) ? s.navLinksRight : [];
      const linkColor = s.linkColor || 'var(--uc-text-muted)';
      const renderLinks = (arr) => arr
        .map(l => `<a href="${l.url||'#'}" class="uc-nav-link" data-store-href style="color:${linkColor};font-size:${s.linkSize||11}px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;white-space:nowrap;transition:color .2s">${l.label||''}</a>`)
        .join('');
      const leftLinksHtml  = renderLinks(allLinks);
      const rightLinksHtml = renderLinks(rightLinks);

      const storeName = s.storeName || s.logoAlt || 'STORE';
      // ARCH defaults to a centered display-serif wordmark; merchants can flip
      // back to a left-aligned system-font wordmark via the editor.
      const layout    = s.logoLayout === 'centered' ? 'centered' : (rightLinks.length ? 'centered' : 'left');
      const useDisplay = s.logoFont !== 'system';
      const logoFont   = useDisplay ? 'var(--uc-heading-font)' : 'var(--uc-body-font)';
      const logoWeight = useDisplay ? 600 : 700;
      const logoSize   = s.logoSize || 22;
      const logoSpacing = s.logoSpacing || (useDisplay ? '.12em' : '.02em');
      const logoTextTransform = useDisplay ? 'uppercase' : 'none';
      const logoHtml = s.logoUrl
        ? `<img src="${s.logoUrl}" alt="${storeName}" data-store-logo class="has-logo" style="height:${s.logoHeight||32}px;width:auto" onerror="this.style.display='none'">`
        : `<span data-store-name style="font-family:${logoFont};font-weight:${logoWeight};font-size:${logoSize}px;letter-spacing:${logoSpacing};text-transform:${logoTextTransform}">${storeName}</span>`;

      const iconBtn = (label, svg, onclick) =>
        `<button type="button" aria-label="${label}" onclick="${onclick}" class="uc-header-icon" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;display:inline-flex;align-items:center;justify-content:center;position:relative">${svg}</button>`;

      const SVG = {
        search:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
        account:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        wishlist: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        cart:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        menu:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
      };

      const cartBadgeHtml = `<span class="uc-cart-badge" data-uc-cart-badge style="position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:50%;background:var(--uc-accent);color:var(--uc-primary-text);font-size:9px;font-weight:500;display:none;align-items:center;justify-content:center;padding:0 4px">0</span>`;

      const icons = [
        s.showSearchIcon   ? iconBtn('Search',   SVG.search,   "window.UC&&UC.focusSearch&&UC.focusSearch()") : '',
        s.showAccountIcon  ? iconBtn('Account',  SVG.account,  "window.location.href='/account'")          : '',
        s.showWishlistIcon ? iconBtn('Wishlist', SVG.wishlist, "window.location.href='/wishlist'")          : '',
        s.showCartIcon ? `<button type="button" aria-label="Cart" onclick="window.UC&&UC.openCart&&UC.openCart()" class="uc-header-icon" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;display:inline-flex;align-items:center;justify-content:center;position:relative">${SVG.cart}${cartBadgeHtml}</button>` : '',
      ].filter(Boolean).join('');

      const hamburger = s.showHamburger
        ? `<button type="button" aria-label="Menu" class="uc-header-hamburger" onclick="window.UC&&UC.openSidebar&&UC.openSidebar()" style="background:none;border:none;color:inherit;cursor:pointer;padding:8px;align-items:center">${SVG.menu}</button>`
        : '';

      // Centered logo: 3-column grid (left links / wordmark / right links + icons).
      // Left logo: flex row.
      const isCentered = layout === 'centered';
      const innerHtml = isCentered
        ? `<div class="uc-header-row uc-header-centered" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;height:${s.height||64}px">
            <div class="uc-header-left" style="display:flex;align-items:center;gap:${s.linkSpacing||24}px">
              ${hamburger}
              <nav class="uc-header-links" style="display:flex;align-items:center;gap:${s.linkSpacing||24}px">${leftLinksHtml}</nav>
            </div>
            <a href="/" class="uc-header-logo" style="justify-self:center;display:inline-flex;align-items:center;gap:8px;color:inherit;text-decoration:none">${logoHtml}</a>
            <div class="uc-header-right" style="display:flex;align-items:center;justify-content:flex-end;gap:${(s.linkSpacing||24) - 4}px">
              <nav class="uc-header-links" style="display:flex;align-items:center;gap:${s.linkSpacing||24}px;margin-right:8px">${rightLinksHtml}</nav>
              <div class="uc-header-icons" style="display:flex;align-items:center;gap:4px">${icons}</div>
            </div>
          </div>`
        : `<div class="uc-header-row" style="display:flex;align-items:center;gap:16px;height:${s.height||64}px">
            ${hamburger}
            <a href="/" class="uc-header-logo" style="display:inline-flex;align-items:center;gap:8px;color:inherit;text-decoration:none">${logoHtml}</a>
            <nav class="uc-header-links" style="display:flex;align-items:center;gap:${s.linkSpacing||24}px;margin-left:24px">${leftLinksHtml}</nav>
            <div class="uc-header-icons" style="display:flex;align-items:center;gap:4px;margin-left:auto">${icons}</div>
          </div>`;

      return `<header class="uc-header" style="background:${s.backgroundColor||'var(--uc-surface)'};color:${s.textColor||'var(--uc-text)'};border-bottom:1px solid var(--uc-border);position:${s.sticky?'sticky':'relative'};top:0;z-index:80;">
        <div class="uc-container uc-w-wide" style="padding:0 32px">${innerHtml}</div>
      </header>`;
    },

    'hero': (sec) => {
      const s = sec.settings;
      const heading      = s.heading    || s.headline    || '';
      const headingItal  = s.headlineItalic || s.headingItalic || '';
      const subheading   = s.subheading || s.subheadline || '';
      const kicker       = s.kicker     || s.eyebrow     || '';
      const seasonMarker = s.seasonMarker || '';
      const showSecondary = s.showSecondaryButton !== false;
      const btns = [s.primaryButton, showSecondary ? s.secondaryButton : null].filter(Boolean).map(renderButton).join(' ');
      const minH = s.minHeight || (sec.layout && sec.layout.minHeight) || 400;

      // ─── ARCH split layout ─────────────────────────────────────────────
      // Photo on the left, ink-on-cream copy + stats strip on the right with
      // a thin vertical rule between them. Falls back gracefully when the
      // merchant hasn't supplied a hero image.
      if ((s.layout || 'split') === 'split') {
        const stats = Array.isArray(s.stats) ? s.stats : [];
        const showStats = s.showStats !== false && stats.length > 0;
        const photo = s.imageUrl
          ? `<img src="${s.imageUrl}" alt="${(s.imageAlt||'').replace(/"/g,'&quot;')}" loading="eager"
              style="width:100%;height:100%;object-fit:cover;object-position:center 20%;filter:brightness(.92) contrast(1.04);transition:transform 8s ease" onerror="this.style.display='none'">`
          : `<div style="width:100%;height:100%;background:var(--uc-surface)"></div>`;
        // data-hero-title sits on an inner span so settings.hero_title can
        // overwrite just the main wordmark while the italic accent
        // (settings.hero_italic / section.headlineItalic) stays untouched.
        const headingHtml = `<h1 class="uc-hero-headline" style="font-family:var(--uc-heading-font);font-size:clamp(40px,4.5vw,72px);font-weight:700;line-height:.95;letter-spacing:-.03em;margin:0 0 28px;color:var(--uc-text)"><span data-hero-title>${heading}</span>${headingItal ? `<span style="display:block;font-weight:400;font-style:italic;color:var(--uc-text-muted);font-size:.72em">${headingItal}</span>` : ''}</h1>`;
        const subHtml = subheading ? `<p data-hero-subtitle style="font-size:14px;line-height:1.6;color:var(--uc-text-muted);margin-bottom:24px;max-width:420px">${subheading}</p>` : '';
        const kickerHtml = kicker
          ? `<div class="uc-hero-kicker" style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--uc-text-muted);margin-bottom:20px;display:flex;align-items:center;gap:10px">
              <span style="display:block;width:28px;height:1px;background:var(--uc-accent)"></span>${kicker}
            </div>`
          : '';
        const seasonHtml = seasonMarker
          ? `<span class="uc-hero-season" aria-hidden="true" style="position:absolute;right:16px;top:50%;transform:translateY(-50%) rotate(90deg);font-size:9px;letter-spacing:.25em;text-transform:uppercase;color:var(--uc-border)">${seasonMarker}</span>`
          : '';
        const statsHtml = showStats ? `<div class="uc-hero-stats" style="position:absolute;bottom:0;left:0;right:0;display:flex;border-top:1px solid var(--uc-border)">
            ${stats.map((st, i) => `<div class="uc-hero-stat" style="flex:1;padding:10px 16px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--uc-text-muted);${i < stats.length - 1 ? 'border-right:1px solid var(--uc-border)' : ''}">
              <strong style="display:block;font-size:15px;font-family:var(--uc-heading-font);font-weight:400;color:var(--uc-text);letter-spacing:0;margin-bottom:1px">${st.value||''}</strong>${st.label||''}
            </div>`).join('')}
          </div>` : '';

        return `<section class="uc-hero uc-hero-split" style="position:relative;height:${minH}px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;background:${s.backgroundColor||'var(--uc-surface)'}">
          <div class="uc-hero-photo" style="position:relative;overflow:hidden;border-right:1px solid var(--uc-border)">${photo}</div>
          <div class="uc-hero-text" style="background:var(--uc-surface);display:flex;flex-direction:column;justify-content:flex-end;padding:44px 48px;position:relative;${showStats ? 'padding-bottom:60px;' : ''}">
            ${seasonHtml}
            ${kickerHtml}
            ${headingHtml}
            ${subHtml}
            ${btns ? `<div style="display:flex;gap:12px;flex-wrap:wrap">${btns}</div>` : ''}
            ${statsHtml}
          </div>
        </section>`;
      }

      // ─── Classic full-bleed layout (preserved for merchants who flip back) ──
      const mediaHtml = s.mediaType === 'video' && s.videoUrl
        ? `<video src="${s.videoUrl}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'"></video>`
        : s.imageUrl
          ? `<img src="${s.imageUrl}" alt="${s.imageAlt||''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'">`
          : '';
      const overlay = s.overlayOpacity > 0 ? `<div style="position:absolute;inset:0;background:${s.overlayColor||'#000'};opacity:${s.overlayOpacity||0};z-index:1"></div>` : '';
      const align = s.textAlign || (sec.layout && sec.layout.contentAlign) || 'center';
      return `<section class="uc-hero" style="position:relative;min-height:${minH}px;display:flex;align-items:${s.verticalAlign||'center'};overflow:hidden">
        ${mediaHtml}${overlay}
        <div class="uc-container uc-w-contained" style="position:relative;z-index:2;text-align:${align};max-width:${s.contentMaxWidth||'var(--uc-container-max)'}${typeof s.contentMaxWidth==='number'?'px':''}">
          ${kicker ? `<p style="text-transform:uppercase;letter-spacing:.1em;font-size:13px;margin-bottom:12px;color:var(--uc-accent)">${kicker}</p>` : ''}
          <h1 style="font-size:clamp(2rem,5vw,${s.headingSize||64}px);font-weight:var(--uc-heading-weight);color:${s.headingColor||'inherit'};margin:0 0 16px"><span data-hero-title>${heading}</span>${headingItal ? `<span style="display:block;font-weight:400;font-style:italic;opacity:.7;font-size:.72em">${headingItal}</span>` : ''}</h1>
          ${subheading ? `<p data-hero-subtitle style="font-size:${s.subheadingSize||20}px;margin-bottom:32px;opacity:.9;color:${s.subheadingColor||'inherit'}">${subheading}</p>` : ''}
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
      const bg        = s.backgroundColor || 'var(--uc-primary)';
      const fg        = s.textColor || 'var(--uc-primary-text)';
      const mutedFg   = 'rgba(255,255,255,.6)';
      const dimFg     = 'rgba(255,255,255,.4)';
      const veryDimFg = 'rgba(255,255,255,.25)';
      const borderCol = 'rgba(255,255,255,.08)';
      const accent    = 'var(--uc-accent)';

      const cols = (sec.blocks || []).filter(b => b.type === 'footer-column' && b.visible !== false)
        .map(b => {
          const linksHtml = Array.isArray(b.settings.links)
            ? b.settings.links.map(l => `<a class="uc-footer-link" href="${l.url||'#'}" style="font-size:12px;color:${mutedFg};text-decoration:none;transition:color .2s" onmouseover="this.style.color='${accent}'" onmouseout="this.style.color='${mutedFg}'">${l.label||''}</a>`).join('')
            : (b.settings.content || '');
          return `<div>
            <div class="uc-footer-col-title" style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:${dimFg};margin-bottom:16px">${b.settings.heading||''}</div>
            <div class="uc-footer-links" style="display:flex;flex-direction:column;gap:10px">${linksHtml}</div>
          </div>`;
        }).join('');

      // ARCH brand column: display-serif wordmark + tagline. Uses store_name
      // injected from settings; falls back to the editor's logo if uploaded.
      const storeName = s.storeName || (window.STORE_SETTINGS && window.STORE_SETTINGS.store_name) || 'STORE';
      const brandCol = `<div>
        ${s.logoUrl
          ? `<img data-store-logo src="${s.logoUrl}" alt="${storeName}" class="has-logo" style="height:36px;margin-bottom:16px;filter:invert(1) brightness(2)">`
          : `<div data-store-name class="uc-footer-logo" style="font-family:var(--uc-heading-font);font-size:28px;font-weight:300;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px;color:${fg}">${storeName}</div>`}
        ${s.aboutText ? `<div data-store-description class="uc-footer-tagline" style="font-size:12px;color:${dimFg};line-height:1.8;max-width:240px">${s.aboutText}</div>` : ''}
      </div>`;

      const social = s.showSocial && s.socialLinks ? Object.entries(s.socialLinks)
        .filter(([, url]) => !!url)
        .map(([k, url]) => `<a href="${url}" target="_blank" rel="noreferrer" aria-label="${k}" style="color:${mutedFg};text-decoration:none;font-size:12px;text-transform:capitalize">${k}</a>`).join(' · ') : '';
      const copyright = s.copyrightText || s.copyright || '';
      const legalLine = s.legalLineText || s.legalText || '';

      return `<footer class="uc-footer" style="background:${bg};color:${fg};padding:64px 48px 32px">
        <div class="uc-container uc-w-wide">
          <div class="uc-footer-grid" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px;margin-bottom:48px">${brandCol}${cols}</div>
          <div class="uc-footer-bottom" style="border-top:1px solid ${borderCol};padding-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
            <div class="uc-footer-copy" style="font-size:11px;color:${veryDimFg}">${copyright}</div>
            ${social
              ? `<div class="uc-footer-copy" style="font-size:11px;color:${veryDimFg}">${social}</div>`
              : legalLine
                ? `<div class="uc-footer-copy" style="font-size:11px;color:${veryDimFg}">${legalLine}</div>`
                : ''}
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
    .uc-header-icon { transition: opacity .15s, color .15s; }
    .uc-header-icon:hover { color: var(--uc-accent); opacity: 1; }
    .uc-nav-link:hover { color: var(--uc-text) !important; }
    .uc-header-hamburger { display: none; }
    @media (max-width: 900px) {
      .uc-header-links { display: none !important; }
      .uc-header-hamburger { display: inline-flex !important; }
      .uc-header-centered { grid-template-columns: auto 1fr auto !important; }
      .uc-header-centered .uc-header-left { gap: 8px !important; }
      .uc-header-centered .uc-header-right .uc-header-links { display: none !important; }
    }

    /* ── Hero (ARCH split) ───────────────────────────────────────── */
    .uc-hero-split:hover .uc-hero-photo img { transform: scale(1.03); }
    @media (max-width: 700px) {
      .uc-hero-split { grid-template-columns: 1fr !important; height: auto !important; }
      .uc-hero-split .uc-hero-photo { height: 220px !important; border-right: none !important; border-bottom: 1px solid var(--uc-border) !important; }
      .uc-hero-split .uc-hero-text { padding: 28px 24px 60px !important; }
      .uc-hero-split .uc-hero-season { display: none !important; }
    }

    /* ── Footer (ARCH grid) ──────────────────────────────────────── */
    @media (max-width: 900px) {
      .uc-footer { padding: 40px 20px 24px !important; }
      .uc-footer-grid { grid-template-columns: 1fr 1fr !important; gap: 32px !important; }
    }
    @media (max-width: 600px) {
      .uc-footer-grid { grid-template-columns: 1fr !important; }
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
      background: var(--uc-surface);
      border: 1px solid var(--uc-border);
      border-radius: var(--uc-card-radius);
      overflow: hidden;
      transition: transform .3s cubic-bezier(.16,1,.3,1), border-color .2s;
      position: relative;
    }
    .uc-product-card:hover { transform: translateY(-2px); border-color: var(--uc-text); }
    .uc-product-card:hover .uc-product-img img { transform: scale(1.04); }
    .uc-product-card:hover .uc-product-atc { opacity: 1; transform: translateY(0); }
    .uc-product-img {
      aspect-ratio: 3/4;
      background: var(--uc-bg);
      overflow: hidden;
      position: relative;
    }
    .uc-product-img img { width: 100%; height: 100%; object-fit: cover; transition: transform .6s cubic-bezier(.16,1,.3,1); }
    .uc-product-info { padding: 16px 14px 20px; }
    .uc-product-name { font-family: var(--uc-heading-font); font-size: 17px; font-weight: 400; line-height: 1.25; margin-bottom: 8px; }
    .uc-product-price { font-size: 13px; color: var(--uc-text); }
    .uc-product-atc {
      position: absolute; left: 12px; right: 12px; bottom: 12px;
      padding: 10px 12px;
      background: var(--uc-surface); color: var(--uc-text);
      border: none; cursor: pointer;
      font: inherit; font-size: 10px; font-weight: 500;
      letter-spacing: .12em; text-transform: uppercase;
      border-radius: var(--uc-radius);
      opacity: 0; transform: translateY(6px);
      transition: opacity .2s, transform .2s, background .2s, color .2s;
    }
    .uc-product-atc:hover { background: var(--uc-accent); color: var(--uc-primary-text); }
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

  // Section types that count as page chrome — rendered into the
  // `#uc-storefront-header` slot on subpages so the merchant's edits in the
  // dashboard cover every page, not just the home page.
  const HEADER_SECTION_TYPES = ['announcement-bar', 'header', 'nav'];
  const FOOTER_SECTION_TYPES = ['footer'];

  function renderSectionWrapper(sec) {
    const renderer = RENDERERS[sec.type];
    if (!renderer) return `<!-- Unknown section type: ${sec.type} -->`;

    // Apply section layout background, padding, min-height
    const layout   = sec.layout || {};
    const bg       = layout.background ? bgToCss(layout.background) : '';
    const padding  = layout.padding    ? spacingToCss(layout.padding, 'padding') : '';
    const margin   = layout.margin     ? spacingToCss(layout.margin,  'margin')  : '';
    const minH     = layout.minHeight  ? `min-height:${layout.minHeight}px;` : '';
    const wrapStyle = [bg, padding, margin, minH].filter(Boolean).join('\n');

    const inner = renderer(sec);
    const customCSS = sec.customCSS
      ? `<style>[data-sec="${sec.id}"] { ${sec.customCSS} }</style>`
      : '';

    return `<div data-sec="${sec.id}" data-type="${sec.type}" style="${wrapStyle.replace(/\n/g, ' ')}">${customCSS}${inner}</div>`;
  }

  function applySchema(schema) {
    currentSchema = schema;

    // ── Global CSS vars ────────────────────────────────────────────────
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'uc-theme-vars';
      document.head.appendChild(styleEl);
    }
    const theme = schema.globalTheme;
    // Only let `body { background, color, font-family, … }` apply on pages
    // that actually delegate the full body to the renderer. Subpages
    // (products / cart / etc.) only host the header + footer slots and have
    // their own static CSS; replacing their body styles would cause a flash
    // of mismatched theme. The full-body rule is therefore gated on the
    // canvas slot existing.
    const hasFullCanvas = !!document.getElementById('uc-editor-canvas');
    const bodyRule = hasFullCanvas
      ? `body { background: var(--uc-bg); color: var(--uc-text); font-family: var(--uc-body-font); font-size: var(--uc-base-font-size); line-height: var(--uc-line-height); }\n`
      : '';
    styleEl.textContent = `:root { ${themeToCssVars(theme)} }\n` +
      bodyRule +
      `h1,h2,h3,h4,h5,h6 { font-family: var(--uc-heading-font); font-weight: var(--uc-heading-weight); }\n` +
      `.uc-container { width: 100%; margin: 0 auto; padding: 0 24px; }\n` +
      `.uc-w-full  { max-width: 100%; padding: 0; }\n` +
      `.uc-w-wide  { max-width: 1440px; }\n` +
      `.uc-w-contained { max-width: var(--uc-container-max); }\n` +
      `.uc-w-narrow { max-width: 720px; }\n` +
      `.uc-section-title { font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: var(--uc-heading-weight); margin-bottom: 12px; }\n` +
      `.uc-section-sub { font-size: 1.05rem; color: var(--uc-text-muted); margin-bottom: 40px; }\n` +
      `.uc-prose { font-size: var(--uc-base-font-size); line-height: 1.8; }\n` +
      `.uc-prose h2 { font-size: 1.5em; margin: 1.5em 0 .5em; }\n` +
      `.uc-prose p { margin: 0 0 1em; }\n` +
      SHOP_CSS +
      (theme.customCSS || '');

    // Load Google Fonts
    loadGoogleFont(theme.typography.headingFont);
    loadGoogleFont(theme.typography.bodyFont);

    // ── Render page sections ───────────────────────────────────────────
    const pageId = Object.keys(schema.pages)[0] || 'index';
    const page   = schema.pages[pageId];
    if (!page) return;

    const visibleSections = page.sections.filter(sec => sec.visible !== false);

    // Full-page canvas (home page + editor preview iframe). Only auto-create
    // a canvas if there are no chrome slots present — subpages opt-out of
    // full rendering by providing #uc-storefront-header / -footer instead.
    const headerSlot = document.getElementById('uc-storefront-header');
    const footerSlot = document.getElementById('uc-storefront-footer');
    const hasChromeSlots = !!(headerSlot || footerSlot);

    if (!mainEl) mainEl = document.getElementById('uc-editor-canvas');
    if (!mainEl && !hasChromeSlots) {
      // Editor preview: no slots at all → fall back to creating a canvas so
      // the iframe still has somewhere to render the schema.
      mainEl = document.createElement('div');
      mainEl.id = 'uc-editor-canvas';
      document.body.appendChild(mainEl);
    }

    if (mainEl) {
      mainEl.innerHTML = visibleSections.map(renderSectionWrapper).join('\n');
    }

    // Header slot: render every chrome-typed section in declaration order
    // (e.g. announcement-bar, then header).
    if (headerSlot) {
      const head = visibleSections.filter(s => HEADER_SECTION_TYPES.indexOf(s.type) !== -1);
      headerSlot.innerHTML = head.map(renderSectionWrapper).join('\n');
    }

    // Footer slot: just the first matching footer section.
    if (footerSlot) {
      const foot = visibleSections.filter(s => FOOTER_SECTION_TYPES.indexOf(s.type) !== -1);
      footerSlot.innerHTML = foot.map(renderSectionWrapper).join('\n');
    }

    // Global chrome (cart drawer + overlay + quick-view modal) and per-section
    // product loaders. Idempotent: safe to call after every schema apply.
    ensureGlobalChrome();
    bootFilterShops();
    syncCartUI();

    // Re-inject store_name / store_description / logo / hero copy into the
    // freshly rendered DOM. theme.js exposes window.applyStoreBrand for
    // exactly this — without it, [data-store-name] / [data-hero-title] etc.
    // would render with the registry's seed text on the live storefront.
    if (typeof window.applyStoreBrand === 'function') window.applyStoreBrand();
  }

  /* ── Global chrome (cart drawer / overlay / quick view modal) ────────── */

  function ensureGlobalChrome() {
    if (document.getElementById('uc-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'uc-overlay';
    overlay.className = 'uc-overlay';
    overlay.addEventListener('click', () => UC.closeAll());
    document.body.appendChild(overlay);

    const drawer = document.createElement('aside');
    drawer.id = 'uc-cart-drawer';
    drawer.className = 'uc-cart-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="uc-cart-header">
        <span class="uc-cart-title">Your Bag</span>
        <button type="button" class="uc-cart-close" aria-label="Close cart" onclick="window.UC&&UC.closeCart&&UC.closeCart()">×</button>
      </div>
      <div class="uc-cart-items" data-uc-cart-items></div>
      <div class="uc-cart-footer">
        <div class="uc-cart-row">
          <span style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--uc-text-muted)">Subtotal</span>
          <span class="uc-cart-subtotal" data-uc-cart-subtotal>$0.00</span>
        </div>
        <a href="/cart.html" class="uc-cart-checkout" data-uc-cart-checkout>Proceed to Checkout</a>
      </div>
    `;
    document.body.appendChild(drawer);

    const modal = document.createElement('div');
    modal.id = 'uc-quick-view';
    modal.className = 'uc-modal-overlay';
    modal.addEventListener('click', e => {
      if (e.target === modal) UC.closeQuickView();
    });
    modal.innerHTML = `
      <div class="uc-modal" role="dialog" aria-modal="true">
        <div class="uc-modal-img" data-uc-qv-img></div>
        <div class="uc-modal-body">
          <button type="button" class="uc-modal-close" onclick="window.UC&&UC.closeQuickView&&UC.closeQuickView()" aria-label="Close">×</button>
          <div data-uc-qv-name class="uc-modal-name"></div>
          <div data-uc-qv-price class="uc-modal-price"></div>
          <div data-uc-qv-desc class="uc-modal-desc"></div>
          <button type="button" class="uc-modal-atc" data-uc-qv-atc>Add to Bag</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  /* ── Cart UI ─────────────────────────────────────────────────────────── */

  function syncCartUI() {
    if (typeof window.getCart !== 'function') return;
    const cart = window.getCart();
    const count = cart.reduce((s, i) => s + (i.quantity || 0), 0);
    const total = cart.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);

    document.querySelectorAll('[data-uc-cart-badge]').forEach(b => {
      b.textContent = count > 99 ? '99+' : String(count);
      b.style.display = count > 0 ? 'flex' : 'none';
    });

    const subtotal = document.querySelector('[data-uc-cart-subtotal]');
    if (subtotal) {
      const currency = (cart[0] && cart[0].currency) || 'usd';
      subtotal.textContent = typeof window.formatPrice === 'function'
        ? window.formatPrice(total, currency)
        : '$' + (total / 100).toFixed(2);
    }

    const itemsEl = document.querySelector('[data-uc-cart-items]');
    if (itemsEl) {
      if (!cart.length) {
        itemsEl.innerHTML = '<div class="uc-cart-empty">Your bag is empty.</div>';
      } else {
        itemsEl.innerHTML = cart.map(it => {
          const price = typeof window.formatPrice === 'function'
            ? window.formatPrice(it.price * it.quantity, it.currency)
            : '$' + ((it.price * it.quantity) / 100).toFixed(2);
          const id = String(it.productId).replace(/'/g, "\\'");
          return `<div class="uc-cart-item">
            ${it.image ? `<img class="uc-cart-item-img" src="${it.image}" alt="" onerror="this.style.display='none'">` : '<div class="uc-cart-item-img"></div>'}
            <div>
              <div class="uc-cart-item-name">${it.name||''}</div>
              <div class="uc-cart-item-price">${price}</div>
              <div class="uc-cart-qty">
                <button type="button" onclick="window.UC&&UC.changeQty('${id}',-1)" aria-label="Decrease">−</button>
                <span>${it.quantity}</span>
                <button type="button" onclick="window.UC&&UC.changeQty('${id}',1)" aria-label="Increase">+</button>
              </div>
              <br>
              <button type="button" class="uc-cart-remove" onclick="window.UC&&UC.removeItem('${id}')">Remove</button>
            </div>
          </div>`;
        }).join('');
      }
    }

    const checkout = document.querySelector('[data-uc-cart-checkout]');
    if (checkout) {
      if (!cart.length) {
        checkout.setAttribute('aria-disabled', 'true');
        checkout.style.pointerEvents = 'none';
        checkout.style.opacity = '.4';
      } else {
        checkout.removeAttribute('aria-disabled');
        checkout.style.pointerEvents = '';
        checkout.style.opacity = '';
      }
    }
  }

  window.addEventListener('bst:cart-updated', syncCartUI);
  document.addEventListener('DOMContentLoaded', syncCartUI);

  /* ── Filter shop loaders ────────────────────────────────────────────── */

  // Per-shop in-memory cache of loaded products keyed by section id.
  const SHOP_STATE = {};

  function bootFilterShops() {
    document.querySelectorAll('[data-uc-filter-shop]').forEach(root => {
      const sectionId = root.closest('[data-sec]') ? root.closest('[data-sec]').getAttribute('data-sec') : root.id;
      if (root.dataset.ucBooted === '1') return;
      root.dataset.ucBooted = '1';
      const collection = root.dataset.ucCollection || '';
      const limit      = parseInt(root.dataset.ucLimit, 10) || 48;
      loadShopProducts(root, sectionId, collection, limit);
    });
  }

  async function loadShopProducts(root, sectionId, collection, limit) {
    const state = SHOP_STATE[sectionId] = { products: [], filters: {}, view: root.dataset.ucDefaultView === 'list' ? 'list' : 'grid' };
    const grid  = root.querySelector('[data-uc-grid]');
    const apiBase = (window.BST_API_BASE || '').replace(/\/$/, '');
    if (!apiBase) {
      // Editor-only environment without an API: render an empty state instead
      // of hanging on a network call that will never resolve.
      const stateEl = grid && grid.querySelector('[data-uc-state]');
      if (stateEl) stateEl.textContent = 'Connect a backend to load products.';
      return;
    }
    try {
      const all = [];
      let offset = 0;
      const pageSize = Math.min(limit, 100);
      while (all.length < limit) {
        const url = apiBase + '/products?limit=' + pageSize + '&offset=' + offset
          + (collection ? '&collection=' + encodeURIComponent(collection) : '');
        const res = await fetch(url, { credentials: 'omit' });
        const body = await res.json();
        if (!body || !body.ok || !Array.isArray(body.data)) break;
        all.push(...body.data);
        if (body.data.length < pageSize) break;
        offset += body.data.length;
      }
      state.products = all.slice(0, limit);
      renderShopGrid(root, sectionId);
    } catch (err) {
      const stateEl = grid && grid.querySelector('[data-uc-state]');
      if (stateEl) stateEl.textContent = 'Failed to load products.';
    }
  }

  function renderShopGrid(root, sectionId) {
    const state = SHOP_STATE[sectionId];
    if (!state) return;
    const grid    = root.querySelector('[data-uc-grid]');
    const showATC = root.dataset.ucShowAtc === '1';
    const countEl = root.querySelector('[data-uc-count]');
    const f       = state.filters || {};

    let list = state.products.slice();

    if (f.search) {
      const q = f.search.toLowerCase();
      list = list.filter(p => (p.name || '').toLowerCase().includes(q));
    }
    if (typeof f.priceMin === 'number') list = list.filter(p => p.price >= f.priceMin * 100);
    if (typeof f.priceMax === 'number') list = list.filter(p => p.price <= f.priceMax * 100);

    if (f.sort === 'price-asc')  list.sort((a, b) => a.price - b.price);
    if (f.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (f.sort === 'name')       list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    grid.classList.remove('uc-view-grid', 'uc-view-list');
    grid.classList.add(state.view === 'list' ? 'uc-view-list' : 'uc-view-grid');

    if (countEl) countEl.textContent = String(list.length);

    if (!list.length) {
      grid.innerHTML = '<p class="uc-shop-state">No products match your filters.</p>';
      return;
    }

    grid.innerHTML = list.map(p => {
      const img   = (p.images && p.images[0]) || '';
      const price = typeof window.formatPrice === 'function'
        ? window.formatPrice(p.price, p.currency)
        : '$' + (p.price / 100).toFixed(2);
      const idAttr = String(p.id).replace(/"/g, '&quot;');
      return `<a href="product.html?id=${encodeURIComponent(p.id)}" class="uc-product-card" data-uc-product-id="${idAttr}">
        <div class="uc-product-img">
          ${img ? `<img src="${img}" alt="${(p.name||'').replace(/"/g,'&quot;')}" loading="lazy" onerror="this.style.display='none'">` : ''}
          ${showATC ? `<button type="button" class="uc-product-atc" onclick="event.preventDefault();event.stopPropagation();window.UC&&UC.addProductToCart(this.closest('.uc-product-card').getAttribute('data-uc-product-id'),'${sectionId}')">Add to Bag</button>` : ''}
        </div>
        <div class="uc-product-info">
          <div class="uc-product-name">${p.name||''}</div>
          <div class="uc-product-price">${price}</div>
        </div>
      </a>`;
    }).join('');
  }

  function findProductById(productId) {
    for (const sid in SHOP_STATE) {
      const p = SHOP_STATE[sid].products.find(x => String(x.id) === String(productId));
      if (p) return p;
    }
    return null;
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
