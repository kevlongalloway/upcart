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

  // Fallback design tokens — kept structurally identical to the editor's
  // DEFAULT_GLOBAL_THEME. Used to guard themeToCssVars() against a malformed
  // or partial globalTheme (the storefront applies raw saved page_sections
  // without the editor's normalizer, and indexing a missing sub-object here
  // would throw and white-screen the page).
  const FALLBACK_THEME = {
    colors: {
      primary: '#161310', primaryText: '#FBF7EE', secondary: '#807767',
      accent: '#B8884A', background: '#F4EFE6', surface: '#FBF7EE',
      text: '#161310', textMuted: '#807767', border: '#E4DCC9',
    },
    typography: {
      headingFont: 'Fraunces', bodyFont: 'Inter Tight', baseFontSize: 15,
      headingWeight: 600, bodyWeight: 400, lineHeight: 1.6, letterSpacing: 0,
    },
    spacing: {
      containerMaxWidth: 1320, sectionVerticalPadding: 96, borderRadius: 0,
      cardBorderRadius: 0, elementGap: 20,
    },
    customCSS: '',
  };

  function normalizeTheme(theme) {
    const t = theme || {};
    return {
      colors:     Object.assign({}, FALLBACK_THEME.colors, t.colors),
      typography: Object.assign({}, FALLBACK_THEME.typography, t.typography),
      spacing:    Object.assign({}, FALLBACK_THEME.spacing, t.spacing),
      customCSS:  typeof t.customCSS === 'string' ? t.customCSS : '',
    };
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
      const heading      = s.heading    || s.headline    || 'Welcome';
      const headingItal  = s.headlineItalic || s.headingItalic || '';
      const subheading   = s.subheading || s.subheadline || '';
      // Editorial chrome — kicker line, season marker — defines the look.
      // Fall back to refined defaults so legacy schemas (without these fields)
      // still paint correctly instead of a half-styled hero.
      const kicker       = s.kicker     || s.eyebrow     || 'The New Arrivals';
      const seasonMarker = typeof s.seasonMarker === 'string' ? s.seasonMarker : '';
      const issueLabel   = s.issueLabel || s.editionLabel || '';
      const minH = s.minHeight || (sec.layout && sec.layout.minHeight) || 640;

      // Build inline CSS from a Typography setting so editor changes
      // (size, weight, color, transform, italic, etc.) actually paint
      // instead of being overridden by the hero's hardcoded class styles.
      const typographyCss = (t) => {
        if (!t || typeof t !== 'object') return '';
        const decls = [];
        if (t.fontFamily && t.fontFamily !== 'inherit') decls.push(`font-family:'${t.fontFamily}',sans-serif`);
        if (typeof t.fontSize === 'number')             decls.push(`font-size:${t.fontSize}px`);
        if (t.fontWeight)                               decls.push(`font-weight:${t.fontWeight}`);
        if (typeof t.lineHeight === 'number')           decls.push(`line-height:${t.lineHeight}`);
        if (typeof t.letterSpacing === 'number')        decls.push(`letter-spacing:${t.letterSpacing}em`);
        if (t.textAlign)                                decls.push(`text-align:${t.textAlign}`);
        if (t.textTransform && t.textTransform !== 'none') decls.push(`text-transform:${t.textTransform}`);
        if (t.color)                                    decls.push(`color:${t.color}`);
        if (t.italic)                                   decls.push('font-style:italic');
        if (t.underline)                                decls.push('text-decoration:underline');
        return decls.join(';');
      };

      // ─── Editorial split layout ────────────────────────────────────────
      // Photo on the left, ink-on-cream copy + stats strip on the right with
      // a thin vertical rule between them. Falls back gracefully when the
      // merchant hasn't supplied a hero image.
      if ((s.layout || 'split') === 'split') {
        const stats = Array.isArray(s.stats) ? s.stats : [];
        const showStats = s.showStats !== false && stats.length > 0;
        // Photo column: real image when supplied, otherwise a tasteful
        // ecru-on-cream placeholder with a thin accent rule so the split
        // layout still reads as intentional editorial chrome instead of an
        // empty white box.
        const photoEmptyClass = s.imageUrl ? '' : ' uc-hero-photo-empty';
        const storeNameForFallback = (window.STORE_SETTINGS && window.STORE_SETTINGS.store_name) || 'Your Store';
        const placeholderEyebrow = typeof s.imagePlaceholderEyebrow === 'string' ? s.imagePlaceholderEyebrow : 'An introduction to';
        const placeholderMeta    = typeof s.imagePlaceholderMeta    === 'string' ? s.imagePlaceholderMeta    : 'Volume I — Édition Studio';
        const photo = s.imageUrl
          ? `<img src="${s.imageUrl}" alt="${(s.imageAlt||'').replace(/"/g,'&quot;')}" loading="eager"
              class="uc-hero-photo-img"
              onerror="this.parentElement.classList.add('uc-hero-photo-empty');this.style.display='none'">`
          : `<div class="uc-hero-photo-fallback">
              ${placeholderEyebrow ? `<span class="uc-hero-photo-eyebrow">${placeholderEyebrow}</span>` : ''}
              <span class="uc-hero-photo-name" data-store-name>${storeNameForFallback}</span>
              <span class="uc-hero-photo-rule"></span>
              ${placeholderMeta ? `<span class="uc-hero-photo-meta">${placeholderMeta}</span>` : ''}
            </div>`;
        // Photo overlay chrome: paginated badge (toggleable, label editable)
        // + corner caption tying the image into the editorial frame.
        const showBadge = s.showPhotoBadge !== false;
        const badgeLabel = typeof s.photoBadgeLabel === 'string' && s.photoBadgeLabel
          ? s.photoBadgeLabel
          : 'N°01';
        const captionText = typeof s.imageCaption === 'string'
          ? s.imageCaption
          : 'Photographed in studio · Édition I';
        const photoOverlay = `
          ${showBadge ? `<span class="uc-hero-photo-badge" aria-hidden="true">
            <span class="uc-hero-photo-badge-rule"></span>
            <span class="uc-hero-photo-badge-num">${badgeLabel}</span>
          </span>` : ''}
          ${captionText ? `<span class="uc-hero-photo-caption" aria-hidden="true">${captionText.replace(/"/g,'&quot;')}</span>` : ''}
        `;

        // Headline: large display serif, hairline italic accent below.
        // Inline typography styles flow from settings.headlineTypography so
        // size/weight/color edits in the panel actually apply.
        const headlineCss = typographyCss(s.headlineTypography);
        const subCss      = typographyCss(s.subheadlineTypography);
        const headingHtml = `<h1 class="uc-hero-headline" style="${headlineCss}">
            <span class="uc-hero-headline-main" data-hero-title>${heading}</span>
            ${headingItal ? `<span class="uc-hero-headline-italic">${headingItal}</span>` : ''}
          </h1>`;
        const subHtml = subheading
          ? `<p class="uc-hero-sub" data-hero-subtitle style="${subCss}">${subheading}</p>`
          : '';
        const kickerHtml = `<div class="uc-hero-kicker">
              <span class="uc-hero-kicker-rule"></span>
              <span class="uc-hero-kicker-text">${kicker}</span>
              ${issueLabel ? `<span class="uc-hero-kicker-issue">${issueLabel}</span>` : ''}
            </div>`;
        const seasonHtml = seasonMarker
          ? `<span class="uc-hero-season" aria-hidden="true">${seasonMarker}</span>`
          : '';
        const statsHtml = showStats ? `<div class="uc-hero-stats">
            ${stats.map((st, i) => `<div class="uc-hero-stat${i < stats.length - 1 ? ' uc-hero-stat--rule' : ''}">
              <strong class="uc-hero-stat-val">${st.value||''}</strong>
              <span class="uc-hero-stat-lbl">${st.label||''}</span>
            </div>`).join('')}
          </div>` : '';

        // Editorial CTA pair: a primary text-link with arrow and a thin
        // secondary "Read the journal" link. We honour label/url/openInNewTab
        // from the merchant's button-style settings, but keep the visual
        // (color / spacing) tied to the editorial frame so a stray
        // backgroundColor doesn't strand the buttons mid-canvas.
        const primary  = s.primaryButton   || {};
        const secondary = s.secondaryButton || {};
        const ctaLabel = primary.label || s.hero_cta || s.ctaLabel || 'Shop the Edit';
        // /products collides with the API route on the tenant worker; the
        // static products *page* is served at /products.html.
        const ctaUrl   = primary.url   || s.ctaUrl   || '/products.html';
        const ctaTarget = primary.openInNewTab ? ' target="_blank" rel="noopener"' : '';
        const arrowSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="flex-shrink:0"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        const showSecondary = s.showSecondaryButton !== false && (secondary.label || s.secondaryLabel);
        const secondaryLabel = secondary.label || s.secondaryLabel || 'Read the Journal';
        const secondaryUrl   = secondary.url   || s.secondaryUrl   || '#';
        const secondaryTarget = secondary.openInNewTab ? ' target="_blank" rel="noopener"' : '';
        const ctaHtml  = `<div class="uc-hero-cta-row">
          <a href="${ctaUrl}"${ctaTarget} data-hero-cta class="uc-hero-cta">${ctaLabel}${arrowSvg}</a>
          ${showSecondary ? `<a href="${secondaryUrl}"${secondaryTarget} class="uc-hero-cta-secondary">${secondaryLabel}</a>` : ''}
        </div>`;

        const heroBg = s.backgroundColor || 'var(--uc-surface)';
        return `<section class="uc-hero uc-hero-split" style="--uc-hero-min:${minH}px;background:${heroBg}">
          <div class="uc-hero-photo${photoEmptyClass}">${photo}${photoOverlay}</div>
          <div class="uc-hero-text${showStats ? ' uc-hero-text--with-stats' : ''}">
            ${seasonHtml}
            <div class="uc-hero-text-inner">
              ${kickerHtml}
              ${headingHtml}
              ${subHtml}
              ${ctaHtml}
            </div>
            ${statsHtml}
          </div>
        </section>`;
      }

      // ─── Classic full-bleed layout (preserved for merchants who flip back) ──
      const showSecondary = s.showSecondaryButton !== false;
      const btns = [s.primaryButton, showSecondary ? s.secondaryButton : null].filter(Boolean).map(renderButton).join(' ');
      const mediaType = s.mediaType || (s.videoUrl ? 'video' : 'image');
      const mediaHtml = mediaType === 'video' && s.videoUrl
        ? `<video src="${s.videoUrl}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'"></video>`
        : s.imageUrl
          ? `<img src="${s.imageUrl}" alt="${s.imageAlt||''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" onerror="this.style.display='none'">`
          : '';
      const overlay = s.overlayOpacity > 0 ? `<div style="position:absolute;inset:0;background:${s.overlayColor||'#000'};opacity:${s.overlayOpacity||0};z-index:1"></div>` : '';
      const align = s.textAlign || (sec.layout && sec.layout.contentAlign) || 'center';
      const verticalAlign = s.verticalAlign || 'center';
      const headlineSize    = typeof s.headingSize    === 'number' ? s.headingSize    : 64;
      const subheadlineSize = typeof s.subheadingSize === 'number' ? s.subheadingSize : 20;
      const headingColorCss    = s.headingColor    ? `color:${s.headingColor}`    : 'color:inherit';
      const subheadingColorCss = s.subheadingColor ? `color:${s.subheadingColor}` : 'color:inherit';
      const heroBgClassic = s.backgroundColor ? `background:${s.backgroundColor};` : '';
      return `<section class="uc-hero" style="${heroBgClassic}position:relative;min-height:${minH}px;display:flex;align-items:${verticalAlign};overflow:hidden">
        ${mediaHtml}${overlay}
        <div class="uc-container uc-w-contained" style="position:relative;z-index:2;text-align:${align};max-width:${s.contentMaxWidth||'var(--uc-container-max)'}${typeof s.contentMaxWidth==='number'?'px':''}">
          ${kicker ? `<p style="text-transform:uppercase;letter-spacing:.1em;font-size:13px;margin-bottom:12px;color:var(--uc-accent)">${kicker}</p>` : ''}
          <h1 style="font-size:clamp(2rem,5vw,${headlineSize}px);font-weight:var(--uc-heading-weight);${headingColorCss};margin:0 0 16px"><span data-hero-title>${heading}</span>${headingItal ? `<span style="display:block;font-weight:400;font-style:italic;opacity:.7;font-size:.72em">${headingItal}</span>` : ''}</h1>
          ${subheading ? `<p data-hero-subtitle style="font-size:${subheadlineSize}px;margin-bottom:32px;opacity:.9;${subheadingColorCss}">${subheading}</p>` : ''}
          ${btns ? `<div style="display:flex;gap:12px;justify-content:${align};flex-wrap:wrap">${btns}</div>` : ''}
        </div>
      </section>`;
    },

    'product-grid': (sec) => {
      const s = sec.settings;
      const cols       = Math.min(Math.max(parseInt(s.columns, 10) || 4, 2), 5);
      const limit      = parseInt(s.limit, 10) || 8;
      const collection = s.collection || '';
      const showATC    = s.showAddToCart !== false;
      const heading    = s.heading || '';
      const subheading = s.subheading || '';
      const eyebrow    = s.eyebrow || (heading ? 'The Edit' : '');
      const showViewAll = s.showViewAll !== false;
      const viewAllText = s.viewAllText || 'View All';
      const viewAllUrl  = s.viewAllUrl  || '/products.html';
      return `<section class="uc-product-grid">
        ${wrapContainer(`
          ${heading || subheading ? `<div class="uc-pg-head">
            ${eyebrow ? `<span class="uc-section-eyebrow">${eyebrow}</span>` : ''}
            ${heading ? `<h2 class="uc-section-title">${heading}</h2>` : ''}
            ${subheading ? `<p class="uc-section-sub">${subheading}</p>` : ''}
          </div>` : ''}
          <div class="uc-product-grid-items uc-pg-grid"
               data-uc-product-grid
               data-uc-cols="${cols}"
               data-uc-limit="${limit}"
               data-uc-collection="${collection}"
               data-uc-show-atc="${showATC ? '1' : '0'}"
               style="--uc-pg-cols:${cols}">
            <p class="uc-pg-state" data-uc-pg-state>Loading products…</p>
          </div>
          ${showViewAll ? `<div class="uc-pg-cta-wrap">
            <a class="uc-pg-cta" href="${viewAllUrl}">${viewAllText}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>` : ''}`, sec.layout)}
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
      // Each tile renders the merchant's image when set; otherwise a cream
      // ecru-tile placeholder so legacy gallery seeds (with empty image
      // blocks) don't render as harsh dark logo plates.
      const items = (sec.blocks || []).filter(b => (b.type === 'gallery-image' || b.type === 'gallery-item') && b.visible !== false)
        .map(b => {
          const url = b.settings.url || b.settings.imageUrl || '';
          const tile = url
            ? `<img src="${url}" alt="${b.settings.alt||''}" loading="lazy"
                style="width:100%;height:${s.imageHeight||280}px;object-fit:cover;display:block;transition:transform .3s"
                onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"
                onerror="this.parentElement.classList.add('uc-gallery-empty');this.style.display='none'">`
            : '';
          const emptyCls = url ? '' : ' uc-gallery-empty';
          return `<div class="uc-gallery-item${emptyCls}" style="overflow:hidden;border-radius:var(--uc-card-radius);background:var(--uc-surface);border:1px solid var(--uc-border);height:${s.imageHeight||280}px;position:relative">
            ${tile}
            ${b.settings.caption ? `<p style="padding:8px 0;font-size:13px;color:var(--uc-text-muted)">${b.settings.caption}</p>` : ''}
          </div>`;
        }).join('');
      return `<section class="uc-gallery">
        ${wrapContainer(`
          ${s.heading ? `<h2 class="uc-section-title" style="font-family:var(--uc-heading-font);font-weight:var(--uc-heading-weight);font-size:clamp(28px,5vw,52px);margin-bottom:24px">${s.heading}</h2>` : ''}
          <div class="uc-gallery-grid" style="display:grid;grid-template-columns:repeat(${s.columns||3},1fr);gap:var(--uc-gap)">${items || ''}</div>`, sec.layout)}
      </section>`;
    },

    'testimonials': (sec) => {
      const s = sec.settings;
      const items = (sec.blocks || []).filter(b => b.type === 'testimonial' && b.visible !== false)
        .map(b => `<figure class="uc-testimonial">
          <span class="uc-testimonial-mark" aria-hidden="true">&ldquo;</span>
          ${s.showRating !== false ? `<span class="uc-testimonial-rating" aria-label="Rated ${b.settings.rating||5} out of 5">${'★'.repeat(b.settings.rating||5)}</span>` : ''}
          <blockquote class="uc-testimonial-quote">${b.settings.quote||b.settings.text||''}</blockquote>
          <figcaption class="uc-testimonial-attr">
            ${s.showAvatar !== false && b.settings.avatarUrl ? `<img src="${b.settings.avatarUrl}" alt="" class="uc-testimonial-avatar">` : ''}
            <div>
              <span class="uc-testimonial-author">${b.settings.author||''}</span>
              ${b.settings.role ? `<span class="uc-testimonial-role">${b.settings.role}</span>` : ''}
            </div>
          </figcaption>
        </figure>`).join('');
      return `<section class="uc-testimonials">
        ${wrapContainer(`
          <div class="uc-testimonials-head">
            ${s.eyebrow ? `<span class="uc-section-eyebrow">${s.eyebrow}</span>` : ''}
            ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
            ${s.subheading ? `<p class="uc-section-sub">${s.subheading}</p>` : ''}
          </div>
          <div class="uc-testimonials-grid">${items||''}</div>`, sec.layout)}
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
      const blocks = (sec.blocks || []).filter(b => b.type === 'feature' && b.visible !== false);
      const items = blocks.map((b, i) => {
        const idx = String(i + 1).padStart(2, '0');
        // Allow merchants to override with a custom icon string, otherwise use
        // the editorial numbered prefix that defines this layout.
        const iconHtml = b.settings.iconUrl
          ? `<img src="${b.settings.iconUrl}" alt="" class="uc-feature-icon-img">`
          : `<span class="uc-feature-num">${b.settings.icon || idx}</span>`;
        const heading = b.settings.heading || b.settings.title || '';
        return `<div class="uc-feature-card">
          <div class="uc-feature-top">
            ${iconHtml}
            <span class="uc-feature-rule"></span>
          </div>
          <h3 class="uc-feature-heading">${heading}</h3>
          <p class="uc-feature-body">${b.settings.description||''}</p>
        </div>`;
      }).join('');
      const cols = parseInt(s.columns, 10) || 3;
      return `<section class="uc-features">
        ${wrapContainer(`
          ${s.eyebrow || s.heading ? `<div class="uc-features-head">
            ${s.eyebrow ? `<span class="uc-section-eyebrow">${s.eyebrow}</span>` : ''}
            ${s.heading ? `<h2 class="uc-section-title">${s.heading}</h2>` : ''}
            ${s.subheading ? `<p class="uc-section-sub">${s.subheading}</p>` : ''}
          </div>` : ''}
          <div class="uc-features-grid" style="--uc-feat-cols:${cols}">${items||''}</div>`, sec.layout)}
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
      return `<section class="uc-newsletter">
        ${wrapContainer(`<div class="uc-newsletter-card">
          <div class="uc-newsletter-rule" aria-hidden="true"></div>
          ${s.eyebrow ? `<span class="uc-section-eyebrow" style="justify-content:center">${s.eyebrow}</span>` : `<span class="uc-section-eyebrow uc-newsletter-eyebrow">Le Journal</span>`}
          ${s.heading ? `<h2 class="uc-newsletter-heading">${s.heading}</h2>` : ''}
          ${description ? `<p class="uc-newsletter-desc">${description}</p>` : ''}
          <form onsubmit="return false" class="uc-newsletter-form">
            <input type="email" placeholder="${s.placeholder||'your@email.com'}" class="uc-newsletter-input">
            <button type="submit" class="uc-newsletter-btn">${buttonText}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
          ${s.disclaimer ? `<p class="uc-newsletter-disclaimer">${s.disclaimer}</p>` : ''}
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
      // Lighter, surface-on-bg footer. The previous dark slab dominated the
      // page; this version uses the surface tone so the footer feels like a
      // graceful close to the page rather than a sudden mood change.
      const bg = s.backgroundColor || 'var(--uc-surface)';
      const fg = s.textColor || 'var(--uc-text)';

      const cols = (sec.blocks || []).filter(b => b.type === 'footer-column' && b.visible !== false)
        .map(b => {
          const linksHtml = Array.isArray(b.settings.links)
            ? b.settings.links.map(l => `<a class="uc-footer-link" href="${l.url||'#'}">${l.label||''}</a>`).join('')
            : (b.settings.content ? `<div class="uc-footer-content">${b.settings.content}</div>` : '');
          return `<div class="uc-footer-col">
            <div class="uc-footer-col-title">${b.settings.heading||''}</div>
            <div class="uc-footer-links">${linksHtml}</div>
          </div>`;
        }).join('');

      const storeName = s.storeName || (window.STORE_SETTINGS && window.STORE_SETTINGS.store_name) || 'Your Store';
      const aboutText = s.aboutText || (window.STORE_SETTINGS && window.STORE_SETTINGS.store_description) || '';
      const brandCol = `<div class="uc-footer-brand">
        ${s.logoUrl
          ? `<img data-store-logo src="${s.logoUrl}" alt="${storeName}" class="has-logo uc-footer-logo-img">`
          : `<div data-store-name class="uc-footer-wordmark">${storeName}</div>`}
        ${aboutText ? `<p data-store-description class="uc-footer-tagline">${aboutText}</p>` : ''}
      </div>`;

      const socialEntries = s.showSocial && s.socialLinks
        ? Object.entries(s.socialLinks).filter(([, url]) => !!url)
        : [];
      const socialHtml = socialEntries.length
        ? `<div class="uc-footer-social">${socialEntries.map(([k, url]) =>
            `<a href="${url}" target="_blank" rel="noreferrer" aria-label="${k}">${k}</a>`).join('')}</div>`
        : '';

      const copyright = s.copyrightText || s.copyright || `© ${new Date().getFullYear()} ${storeName}. All rights reserved.`;
      const legalLine = s.legalLineText || s.legalText || '';

      return `<footer class="uc-footer" style="background:${bg};color:${fg}">
        <div class="uc-container uc-w-wide">
          <div class="uc-footer-grid">${brandCol}${cols}</div>
          <div class="uc-footer-bottom">
            <div class="uc-footer-copy">${copyright}</div>
            ${socialHtml || (legalLine ? `<div class="uc-footer-copy">${legalLine}</div>` : '')}
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
    .uc-nav-link { position: relative; transition: color .2s; }
    .uc-nav-link::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -4px;
      height: 1px; background: currentColor;
      transform: scaleX(0); transform-origin: right;
      transition: transform .35s cubic-bezier(.7,0,.3,1);
    }
    .uc-nav-link:hover { color: var(--uc-text) !important; }
    .uc-nav-link:hover::after { transform: scaleX(1); transform-origin: left; }
    .uc-header-hamburger { display: none; }
    @media (max-width: 900px) {
      .uc-header-links { display: none !important; }
      .uc-header-hamburger { display: inline-flex !important; }
      .uc-header-centered { grid-template-columns: auto 1fr auto !important; }
      .uc-header-centered .uc-header-left { gap: 8px !important; }
      .uc-header-centered .uc-header-right .uc-header-links { display: none !important; }
    }

    /* ── Hero (editorial split) ──────────────────────────────────── */
    .uc-hero-split {
      position: relative;
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      min-height: var(--uc-hero-min, 640px);
      overflow: hidden;
    }
    .uc-hero-photo {
      position: relative; overflow: hidden;
      border-right: 1px solid var(--uc-border);
      background: var(--uc-bg);
    }
    .uc-hero-photo-img {
      width: 100%; height: 100%; object-fit: cover;
      object-position: center 30%;
      filter: brightness(.94) contrast(1.05) saturate(1.02);
      transform: scale(1.04);
      transition: transform 14s ease-out, filter .6s ease;
    }
    .uc-hero-split:hover .uc-hero-photo-img { transform: scale(1.10); }

    .uc-hero-photo-badge {
      position: absolute; top: 28px; left: 28px;
      display: inline-flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      background: rgba(251,247,238,0.92);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      color: var(--uc-text);
      font-family: var(--uc-body-font);
      font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
    }
    .uc-hero-photo-badge-rule {
      display: inline-block; width: 22px; height: 1px;
      background: var(--uc-accent);
    }
    .uc-hero-photo-badge-num { font-weight: 500; }

    .uc-hero-photo-caption {
      position: absolute; bottom: 24px; left: 28px; right: 28px;
      font-family: var(--uc-body-font);
      font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
      color: rgba(251,247,238,.82);
      text-shadow: 0 1px 12px rgba(0,0,0,.35);
    }

    /* Empty / missing hero image: warm gradient + store wordmark so a brand
       new merchant who hasn't uploaded a hero image still sees an inviting,
       branded fallback instead of an empty striped panel. */
    .uc-hero-photo-empty {
      background:
        radial-gradient(140% 100% at 30% 25%, var(--uc-surface) 0%, var(--uc-bg) 55%, #ECE3D0 100%) !important;
    }
    .uc-hero-photo-empty .uc-hero-photo-badge,
    .uc-hero-photo-empty .uc-hero-photo-caption { display: none; }
    .uc-hero-photo-fallback {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 22px; padding: 48px;
      text-align: center;
    }
    .uc-hero-photo-eyebrow {
      font-family: var(--uc-body-font);
      font-size: 10px; letter-spacing: .3em; text-transform: uppercase;
      color: var(--uc-text-muted);
    }
    .uc-hero-photo-name {
      font-family: var(--uc-heading-font);
      font-feature-settings: "ss01";
      font-size: clamp(40px, 5.5vw, 72px);
      font-weight: 500;
      letter-spacing: -.005em;
      line-height: 1;
      color: var(--uc-text);
      max-width: 92%;
    }
    .uc-hero-photo-rule {
      display: block; width: 56px; height: 1px;
      background: var(--uc-accent);
      opacity: .9;
    }
    .uc-hero-photo-meta {
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-size: 14px; color: var(--uc-text-muted);
      letter-spacing: .01em;
    }

    .uc-hero-text {
      background: var(--uc-surface);
      display: flex; flex-direction: column;
      padding: 56px 64px 56px 72px;
      position: relative;
    }
    .uc-hero-text--with-stats { padding-bottom: 80px; }
    .uc-hero-text-inner {
      margin-top: auto;
      max-width: 540px;
    }

    .uc-hero-season {
      position: absolute; right: 24px; top: 50%;
      transform: translateY(-50%) rotate(90deg); transform-origin: center;
      font-family: var(--uc-body-font);
      font-size: 10px; letter-spacing: .35em; text-transform: uppercase;
      color: var(--uc-text-muted); opacity: .55;
      white-space: nowrap;
    }

    .uc-hero-kicker {
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 28px;
      font-family: var(--uc-body-font);
      font-size: 10px; letter-spacing: .26em; text-transform: uppercase;
      color: var(--uc-text-muted);
    }
    .uc-hero-kicker-rule {
      display: inline-block; width: 32px; height: 1px;
      background: var(--uc-accent);
      flex-shrink: 0;
    }
    .uc-hero-kicker-text { color: var(--uc-text); font-weight: 500; }
    .uc-hero-kicker-issue {
      margin-left: auto;
      padding-left: 14px;
      border-left: 1px solid var(--uc-border);
      color: var(--uc-text-muted);
    }

    .uc-hero-headline {
      font-family: var(--uc-heading-font);
      font-feature-settings: "ss01", "lnum";
      font-size: clamp(48px, 6vw, 92px);
      font-weight: 500;
      line-height: .95;
      letter-spacing: -.02em;
      margin: 0 0 28px;
      color: var(--uc-text);
    }
    .uc-hero-headline-main { display: block; }
    .uc-hero-headline-italic {
      display: block;
      font-style: italic;
      font-weight: 400;
      color: var(--uc-text-muted);
      font-size: .68em;
      letter-spacing: -.012em;
      margin-top: 4px;
    }

    .uc-hero-sub {
      font-family: var(--uc-body-font);
      font-size: 15px;
      line-height: 1.7;
      color: var(--uc-text-muted);
      margin: 0 0 36px;
      max-width: 460px;
    }

    .uc-hero-cta-row {
      display: flex; align-items: center; gap: 28px;
      flex-wrap: wrap;
    }
    .uc-hero-cta {
      display: inline-flex; align-items: center; gap: 12px;
      padding: 16px 28px;
      background: var(--uc-text); color: var(--uc-bg);
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
      font-weight: 500;
      text-decoration: none;
      transition: background .25s ease, color .25s ease, gap .3s ease, letter-spacing .3s ease;
    }
    .uc-hero-cta:hover {
      background: var(--uc-accent); color: var(--uc-bg);
      gap: 18px; letter-spacing: .26em;
    }
    .uc-hero-cta svg { transition: transform .3s ease; }
    .uc-hero-cta:hover svg { transform: translateX(3px); }
    .uc-hero-cta-secondary {
      display: inline-flex; align-items: center;
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
      color: var(--uc-text);
      text-decoration: none;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--uc-border-mid, var(--uc-border));
      transition: border-color .25s, color .25s;
    }
    .uc-hero-cta-secondary:hover { color: var(--uc-accent); border-color: var(--uc-accent); }

    .uc-hero-stats {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; border-top: 1px solid var(--uc-border);
      background: var(--uc-surface);
    }
    .uc-hero-stat {
      flex: 1;
      padding: 16px 22px;
      font-family: var(--uc-body-font);
      font-size: 9px; letter-spacing: .22em; text-transform: uppercase;
      color: var(--uc-text-muted);
    }
    .uc-hero-stat--rule { border-right: 1px solid var(--uc-border); }
    .uc-hero-stat-val {
      display: block;
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-weight: 500;
      font-size: 22px;
      color: var(--uc-text);
      letter-spacing: -.01em;
      margin-bottom: 4px;
    }
    .uc-hero-stat-lbl { display: block; }

    /* ── Gallery empty tile placeholder ─────────────────────────── */
    .uc-gallery-empty {
      background:
        repeating-linear-gradient(135deg, var(--uc-bg) 0 18px, var(--uc-surface) 18px 36px) !important;
      display: flex; align-items: center; justify-content: center;
    }
    .uc-gallery-empty::after {
      content: ''; display: block;
      width: 36px; height: 1px; background: var(--uc-accent);
    }

    @media (max-width: 1024px) {
      .uc-hero-text { padding: 48px 48px; }
    }
    @media (max-width: 760px) {
      .uc-hero-split { grid-template-columns: 1fr !important; min-height: auto !important; }
      .uc-hero-split .uc-hero-photo { height: 380px; border-right: none; border-bottom: 1px solid var(--uc-border); }
      .uc-hero-text { padding: 40px 28px 80px; }
      .uc-hero-text--with-stats { padding-bottom: 92px; }
      .uc-hero-season { display: none; }
      .uc-hero-photo-badge { top: 16px; left: 16px; padding: 8px 12px; font-size: 9px; }
      .uc-hero-photo-caption { left: 16px; right: 16px; bottom: 14px; font-size: 9px; }
      .uc-hero-headline { font-size: clamp(40px, 11vw, 64px); }
      .uc-hero-stat-val { font-size: 18px; }
      .uc-hero-stat { padding: 12px 14px; }
    }

    /* ── Footer (works on light or dark bg via currentColor) ─────── */
    .uc-footer {
      padding: 96px 48px 36px;
      font-family: var(--uc-body-font);
    }
    .uc-footer .uc-footer-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr 1fr 1fr;
      gap: 56px;
      padding-bottom: 56px;
      border-bottom: 1px solid currentColor;
      border-bottom-color: rgba(255,255,255,0.10);
    }
    .uc-footer[style*="surface"] .uc-footer-grid,
    .uc-footer[style*="F4EFE6"] .uc-footer-grid,
    .uc-footer[style*="FBF7EE"] .uc-footer-grid {
      border-bottom-color: var(--uc-border);
    }
    .uc-footer-brand { max-width: 320px; }
    .uc-footer-wordmark {
      font-family: var(--uc-heading-font);
      font-size: 28px; font-weight: 500;
      letter-spacing: -.005em;
      margin-bottom: 18px;
      color: currentColor;
    }
    .uc-footer-logo-img { height: 36px; width: auto; margin-bottom: 18px; }
    .uc-footer-tagline {
      font-size: 13px; line-height: 1.75;
      color: currentColor; opacity: .7;
      margin: 0;
      max-width: 320px;
    }
    .uc-footer-col-title {
      font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
      color: currentColor; opacity: .55;
      font-weight: 500;
      margin-bottom: 22px;
    }
    .uc-footer-links { display: flex; flex-direction: column; gap: 12px; }
    .uc-footer-link, .uc-footer-content {
      font-size: 13px; color: currentColor;
      text-decoration: none;
      transition: opacity .2s, color .2s;
      opacity: .82;
      letter-spacing: .01em;
    }
    .uc-footer-link:hover { opacity: 1; color: var(--uc-accent); }
    .uc-footer-bottom {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 14px;
      padding-top: 28px;
    }
    .uc-footer-copy {
      font-size: 11px; color: currentColor; opacity: .5;
      letter-spacing: .08em;
    }
    .uc-footer-social { display: flex; gap: 22px; }
    .uc-footer-social a {
      font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
      color: currentColor; opacity: .55; text-decoration: none;
      transition: opacity .2s, color .2s;
    }
    .uc-footer-social a:hover { opacity: 1; color: var(--uc-accent); }
    @media (max-width: 900px) {
      .uc-footer { padding: 64px 24px 28px; }
      .uc-footer .uc-footer-grid { grid-template-columns: 1fr 1fr; gap: 36px; padding-bottom: 36px; }
    }
    @media (max-width: 600px) {
      .uc-footer .uc-footer-grid { grid-template-columns: 1fr; gap: 28px; }
      .uc-footer-bottom { flex-direction: column; align-items: flex-start; }
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
      background: transparent;
      border: none;
      border-radius: var(--uc-card-radius);
      overflow: visible;
      transition: transform .35s cubic-bezier(.16,1,.3,1);
      position: relative;
    }
    .uc-product-card:hover .uc-product-img img { transform: scale(1.05); }
    .uc-product-card:hover .uc-product-img::after { opacity: 1; }
    .uc-product-card:hover .uc-product-atc { opacity: 1; transform: translateY(0); }
    .uc-product-card:hover .uc-product-name { color: var(--uc-accent-d, var(--uc-accent)); }
    .uc-product-img {
      aspect-ratio: 3/4;
      background: var(--uc-surface);
      overflow: hidden;
      position: relative;
      border-radius: var(--uc-card-radius);
    }
    .uc-product-img::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(180deg, transparent 55%, rgba(22,19,16,0.18) 100%);
      opacity: 0; transition: opacity .3s ease;
      pointer-events: none;
    }
    .uc-product-img img {
      width: 100%; height: 100%; object-fit: cover;
      transition: transform .8s cubic-bezier(.16,1,.3,1), filter .3s ease;
    }
    .uc-product-info { padding: 18px 2px 4px; }
    .uc-product-name {
      font-family: var(--uc-heading-font);
      font-size: 17px; font-weight: 400; line-height: 1.3;
      margin-bottom: 6px;
      letter-spacing: -.005em;
      transition: color .2s ease;
    }
    .uc-product-price {
      font-family: var(--uc-body-font);
      font-size: 12px; letter-spacing: .04em;
      color: var(--uc-text-muted);
    }
    .uc-product-atc {
      position: absolute; left: 16px; right: 16px; bottom: 16px;
      padding: 13px 16px;
      background: var(--uc-bg); color: var(--uc-text);
      border: 1px solid transparent;
      cursor: pointer;
      font: inherit; font-size: 10px; font-weight: 500;
      letter-spacing: .22em; text-transform: uppercase;
      opacity: 0; transform: translateY(8px);
      transition: opacity .25s ease, transform .25s ease, background .25s, color .25s;
    }
    .uc-product-atc:hover { background: var(--uc-text); color: var(--uc-bg); }
    @media (hover: none) { .uc-product-atc { opacity: 1; transform: none; } }

    /* ── Decorative section frame: brass eyebrow rule above titles ─ */
    .uc-pg-head, .uc-features > div > .uc-container, .uc-newsletter > div > .uc-container,
    .uc-info > div, .uc-categories > div > .uc-container, .uc-testimonials > div > .uc-container { position: relative; }

    /* ── Product grid head + view-all CTA ───────────────────────── */
    .uc-pg-head {
      text-align: center;
      max-width: 720px;
      margin: 0 auto 56px;
      display: flex; flex-direction: column; align-items: center;
    }
    .uc-pg-head .uc-section-sub { text-align: center; }
    .uc-pg-cta-wrap {
      display: flex; justify-content: center;
      margin-top: 56px;
    }
    .uc-pg-cta {
      display: inline-flex; align-items: center; gap: 12px;
      padding: 14px 0;
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
      color: var(--uc-text);
      text-decoration: none;
      border-bottom: 1px solid var(--uc-text);
      transition: color .25s, gap .3s, border-color .25s;
    }
    .uc-pg-cta:hover { color: var(--uc-accent); border-color: var(--uc-accent); gap: 18px; }

    /* ── Features (numbered editorial cards) ────────────────────── */
    .uc-features-head {
      max-width: 640px;
      margin: 0 auto 64px;
      display: flex; flex-direction: column; align-items: center; text-align: center;
    }
    .uc-features-head .uc-section-sub { text-align: center; }
    .uc-features-grid {
      display: grid;
      grid-template-columns: repeat(var(--uc-feat-cols, 3), 1fr);
      gap: 0;
      border-top: 1px solid var(--uc-border);
      border-bottom: 1px solid var(--uc-border);
    }
    .uc-feature-card {
      padding: 44px 36px;
      border-right: 1px solid var(--uc-border);
      transition: background .3s ease;
    }
    .uc-feature-card:last-child { border-right: none; }
    .uc-feature-card:hover { background: var(--uc-surface); }
    .uc-feature-top {
      display: flex; align-items: center; gap: 16px;
      margin-bottom: 22px;
    }
    .uc-feature-num {
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-size: 22px;
      font-weight: 500;
      color: var(--uc-accent);
      letter-spacing: -.01em;
    }
    .uc-feature-icon-img { width: 28px; height: 28px; object-fit: contain; }
    .uc-feature-rule {
      flex: 1; height: 1px;
      background: var(--uc-border);
    }
    .uc-feature-heading {
      font-family: var(--uc-heading-font);
      font-size: 22px; font-weight: 500; line-height: 1.2;
      margin: 0 0 12px;
      color: var(--uc-text);
      letter-spacing: -.01em;
    }
    .uc-feature-body {
      font-family: var(--uc-body-font);
      font-size: 14px; line-height: 1.65;
      color: var(--uc-text-muted);
      margin: 0;
    }
    @media (max-width: 900px) {
      .uc-features-grid { grid-template-columns: 1fr !important; }
      .uc-feature-card { border-right: none; border-bottom: 1px solid var(--uc-border); padding: 32px 24px; }
      .uc-feature-card:last-child { border-bottom: none; }
    }

    /* ── Testimonials (editorial quote cards) ───────────────────── */
    .uc-testimonials-head {
      text-align: center; max-width: 640px;
      margin: 0 auto 56px;
      display: flex; flex-direction: column; align-items: center;
    }
    .uc-testimonials-head .uc-section-sub { text-align: center; }
    .uc-testimonials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 28px;
    }
    .uc-testimonial {
      position: relative;
      padding: 40px 32px 32px;
      background: var(--uc-bg);
      border: 1px solid var(--uc-border);
      transition: transform .3s ease, border-color .3s ease, box-shadow .3s ease;
      margin: 0;
    }
    .uc-testimonial:hover {
      transform: translateY(-2px);
      border-color: var(--uc-accent);
      box-shadow: 0 18px 48px -28px rgba(22,19,16,0.28);
    }
    .uc-testimonial-mark {
      position: absolute; top: -10px; left: 22px;
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-size: 96px; line-height: 1;
      color: var(--uc-accent);
      pointer-events: none;
    }
    .uc-testimonial-rating {
      display: block;
      color: var(--uc-accent);
      font-size: 14px; letter-spacing: .12em;
      margin-bottom: 18px;
    }
    .uc-testimonial-quote {
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-weight: 400;
      font-size: 18px; line-height: 1.55;
      letter-spacing: -.005em;
      color: var(--uc-text);
      margin: 0 0 28px;
      quotes: none;
    }
    .uc-testimonial-quote::before, .uc-testimonial-quote::after { content: none; }
    .uc-testimonial-attr {
      display: flex; align-items: center; gap: 14px;
      padding-top: 20px;
      border-top: 1px solid var(--uc-border);
    }
    .uc-testimonial-avatar {
      width: 40px; height: 40px;
      object-fit: cover; border-radius: 50%;
    }
    .uc-testimonial-author {
      display: block;
      font-family: var(--uc-body-font);
      font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
      color: var(--uc-text);
    }
    .uc-testimonial-role {
      display: block;
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .1em;
      color: var(--uc-text-muted);
      margin-top: 3px;
    }

    /* ── Newsletter (editorial centered card) ───────────────────── */
    .uc-newsletter-card {
      max-width: 600px; margin: 0 auto;
      text-align: center;
      display: flex; flex-direction: column; align-items: center;
      position: relative;
    }
    .uc-newsletter-rule {
      width: 1px; height: 56px;
      background: var(--uc-accent);
      margin-bottom: 28px;
    }
    .uc-newsletter-eyebrow { justify-content: center; }
    .uc-newsletter-heading {
      font-family: var(--uc-heading-font);
      font-size: clamp(28px, 4vw, 44px);
      font-weight: 500;
      line-height: 1.05;
      letter-spacing: -.018em;
      margin: 0 0 14px;
      color: var(--uc-text);
    }
    .uc-newsletter-desc {
      font-family: var(--uc-heading-font);
      font-style: italic;
      font-weight: 400;
      font-size: 16px; line-height: 1.6;
      color: var(--uc-text-muted);
      margin: 0 0 36px;
      max-width: 460px;
    }
    .uc-newsletter-form {
      display: flex; align-items: stretch;
      width: 100%; max-width: 460px;
      border: 1px solid var(--uc-text);
      background: var(--uc-bg);
    }
    .uc-newsletter-input {
      flex: 1; min-width: 0;
      padding: 16px 18px;
      border: none; outline: none;
      background: transparent; color: var(--uc-text);
      font: inherit; font-family: var(--uc-body-font);
      font-size: 13px; letter-spacing: .04em;
    }
    .uc-newsletter-input::placeholder { color: var(--uc-text-muted); letter-spacing: .04em; }
    .uc-newsletter-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 14px 22px;
      background: var(--uc-text); color: var(--uc-bg);
      border: none;
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
      font-weight: 500;
      cursor: pointer;
      transition: background .25s, color .25s, gap .3s;
    }
    .uc-newsletter-btn:hover { background: var(--uc-accent); gap: 14px; }
    .uc-newsletter-disclaimer {
      font-family: var(--uc-body-font);
      font-size: 11px; letter-spacing: .08em;
      color: var(--uc-text-muted);
      margin: 22px 0 0;
    }
    @media (max-width: 600px) {
      .uc-newsletter-form { flex-direction: column; }
      .uc-newsletter-btn { justify-content: center; }
    }

    .uc-shop-grid.uc-view-list .uc-product-card { display: grid; grid-template-columns: 140px 1fr; }
    .uc-shop-grid.uc-view-list .uc-product-img { aspect-ratio: auto; height: 100%; }
    .uc-shop-grid.uc-view-list .uc-product-info { display: flex; flex-direction: column; justify-content: center; padding: 20px; }
    .uc-shop-grid.uc-view-list .uc-product-atc {
      position: static; margin-top: 12px; max-width: 180px;
      opacity: 1; transform: none;
    }

    /* ── Plain product-grid section ─────────────────────────────── */
    .uc-pg-head { margin-bottom: 32px; text-align: center; }
    .uc-pg-head .uc-section-title { margin-bottom: 8px; }
    .uc-pg-head .uc-section-sub { margin-bottom: 0; }
    .uc-pg-grid {
      display: grid;
      grid-template-columns: repeat(var(--uc-pg-cols, 4), minmax(0, 1fr));
      gap: 20px;
    }
    @media (max-width: 900px) { .uc-pg-grid { grid-template-columns: repeat(3, 1fr); gap: 14px; } }
    @media (max-width: 600px) { .uc-pg-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
    .uc-pg-state { grid-column: 1/-1; padding: 60px 0; text-align: center;
      color: var(--uc-text-muted); font-size: 12px; letter-spacing: .15em; text-transform: uppercase; }
    .uc-soldout .uc-product-img img { opacity: 0.55; }
    .uc-soldout-badge {
      position: absolute; top: 12px; left: 12px;
      background: var(--uc-bg); color: var(--uc-text);
      font-size: 9px; letter-spacing: .2em; text-transform: uppercase;
      padding: 5px 10px; border: 1px solid var(--uc-border);
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

  // Section types whose renderers own their own chrome (background, padding,
  // borders) end-to-end. For these the saved layout's wrapper padding/bg is
  // ignored so legacy schemas don't bracket the ARCH hero / header / footer
  // with a stale white frame and 120px of padding.
  const SELF_CHROMED = new Set(['hero', 'header', 'nav', 'announcement-bar', 'footer']);

  function renderSectionWrapper(sec) {
    const renderer = RENDERERS[sec.type];
    if (!renderer) return `<!-- Unknown section type: ${sec.type} -->`;

    // Apply section layout background, padding, min-height — except for
    // self-chromed sections (see SELF_CHROMED above).
    const selfChromed = SELF_CHROMED.has(sec.type);
    const layout   = sec.layout || {};
    const bg       = !selfChromed && layout.background ? bgToCss(layout.background) : '';
    const padding  = !selfChromed && layout.padding    ? spacingToCss(layout.padding, 'padding') : '';
    const margin   = layout.margin     ? spacingToCss(layout.margin,  'margin')  : '';
    const minH     = !selfChromed && layout.minHeight  ? `min-height:${layout.minHeight}px;` : '';
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
    const theme = normalizeTheme(schema.globalTheme);
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
      `a { color: inherit; }\n` +
      `.uc-container { width: 100%; margin: 0 auto; padding: 0 24px; }\n` +
      `@media (min-width: 900px) { .uc-container { padding: 0 40px; } }\n` +
      `.uc-w-full  { max-width: 100%; padding: 0; }\n` +
      `.uc-w-wide  { max-width: 1440px; }\n` +
      `.uc-w-contained { max-width: var(--uc-container-max); }\n` +
      `.uc-w-narrow { max-width: 720px; }\n` +
      `.uc-section-title { font-family: var(--uc-heading-font); font-size: clamp(2rem, 4vw, 3.5rem); font-weight: 500; line-height: 1.04; letter-spacing: -.022em; margin-bottom: 14px; }\n` +
      `.uc-section-eyebrow { display: inline-flex; align-items: center; gap: 12px; font-family: var(--uc-body-font); font-size: 10px; letter-spacing: .26em; text-transform: uppercase; color: var(--uc-text-muted); margin-bottom: 18px; }\n` +
      `.uc-section-eyebrow::before { content: ''; display: inline-block; width: 28px; height: 1px; background: var(--uc-accent); }\n` +
      `.uc-section-sub { font-family: var(--uc-heading-font); font-style: italic; font-weight: 400; font-size: 1.15rem; color: var(--uc-text-muted); margin-bottom: 48px; line-height: 1.55; max-width: 520px; }\n` +
      `.uc-prose { font-size: var(--uc-base-font-size); line-height: 1.8; }\n` +
      `.uc-prose h2 { font-size: 1.5em; margin: 1.5em 0 .5em; }\n` +
      `.uc-prose p { margin: 0 0 1em; }\n` +
      // Default vertical breathing room for body sections so stacked sections
      // don't crash into each other when the merchant hasn't set per-section
      // padding. Self-chromed sections (hero / header / footer / announcement
      // bar) own their own spacing and skip this rule via :not().
      `[data-sec][data-type]:not([data-type="hero"]):not([data-type="header"]):not([data-type="nav"]):not([data-type="announcement-bar"]):not([data-type="footer"]):not([data-type="spacer"]):not([data-type="divider"]) { padding: clamp(56px, 7vw, 96px) 0; }\n` +
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
    bootProductGrids();
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

  // Plain product-grid sections: no filters/sort, just a simple responsive
  // grid of cards. Each grid loads its own product slice from the API and
  // renders cards with optional Add-to-Bag.
  function bootProductGrids() {
    document.querySelectorAll('[data-uc-product-grid]').forEach(grid => {
      if (grid.dataset.ucBooted === '1') return;
      grid.dataset.ucBooted = '1';
      const collection = grid.dataset.ucCollection || '';
      const limit      = parseInt(grid.dataset.ucLimit, 10) || 8;
      const showATC    = grid.dataset.ucShowAtc !== '0';
      loadProductGrid(grid, collection, limit, showATC);
    });
  }

  async function loadProductGrid(grid, collection, limit, showATC) {
    const stateEl = grid.querySelector('[data-uc-pg-state]');
    const apiBase = (window.BST_API_BASE || '').replace(/\/$/, '');
    const setMsg  = (msg) => { grid.innerHTML = `<p class="uc-pg-state">${msg}</p>`; };

    if (!apiBase) {
      // No API configured (preview/editor): leave the placeholder visible
      // rather than hanging on a request that will never resolve.
      if (stateEl) stateEl.textContent = 'Connect a backend to load products.';
      return;
    }

    try {
      const url = apiBase + '/products?limit=' + limit + '&offset=0'
        + (collection ? '&collection=' + encodeURIComponent(collection) : '');
      const res  = await fetch(url, { credentials: 'omit' });
      const body = await res.json();
      if (!body || !body.ok || !Array.isArray(body.data)) {
        setMsg('No products yet.');
        return;
      }
      const products = body.data.slice(0, limit);
      if (!products.length) {
        setMsg('No products yet — add some from the dashboard.');
        return;
      }
      // Cache so quick-view / add-to-cart can find these by id without
      // re-requesting them.
      const sid = 'pg-' + (grid.closest('[data-sec]') ? grid.closest('[data-sec]').getAttribute('data-sec') : Math.random().toString(36).slice(2, 8));
      SHOP_STATE[sid] = { products, filters: {}, view: 'grid' };

      grid.innerHTML = products.map(p => {
        const img   = (p.images && p.images[0]) || '';
        const price = typeof window.formatPrice === 'function'
          ? window.formatPrice(p.price, p.currency)
          : '$' + (p.price / 100).toFixed(2);
        const idAttr  = String(p.id).replace(/"/g, '&quot;');
        const soldOut = p.stock === 0;
        return `<a href="product.html?id=${encodeURIComponent(p.id)}" class="uc-product-card${soldOut?' uc-soldout':''}" data-uc-product-id="${idAttr}">
          <div class="uc-product-img">
            ${img ? `<img src="${img}" alt="${(p.name||'').replace(/"/g,'&quot;')}" loading="lazy" onerror="this.style.display='none'">` : ''}
            ${soldOut ? '<span class="uc-soldout-badge">Sold Out</span>' : ''}
            ${(showATC && !soldOut) ? `<button type="button" class="uc-product-atc" onclick="event.preventDefault();event.stopPropagation();window.UC&&UC.addProductToCart(this.closest('.uc-product-card').getAttribute('data-uc-product-id'))">Add to Bag</button>` : ''}
          </div>
          <div class="uc-product-info">
            <div class="uc-product-name">${p.name||''}</div>
            <div class="uc-product-price">${price}</div>
          </div>
        </a>`;
      }).join('');
    } catch (err) {
      setMsg('Couldn’t load products.');
    }
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

  // Build a polished default schema so a brand-new merchant — or one whose
  // saved schema couldn't be loaded — sees a complete, branded storefront
  // instead of an empty canvas. Mirrors the seed in
  // provisioning-service/src/defaults/store-schema.ts so the live storefront
  // and the editor stay in sync.
  function buildDefaultSchema(settings) {
    var s    = settings || {};
    var name = s.store_name || 'Maison';
    var year = new Date().getFullYear();
    return {
      version: '2.0',
      globalTheme: {
        preset: 'base',
        colors: {
          primary:    '#161310',
          primaryText:'#FBF7EE',
          secondary:  '#807767',
          accent:     '#B8884A',
          background: '#F4EFE6',
          surface:    '#FBF7EE',
          text:       '#161310',
          textMuted:  '#807767',
          border:     '#E4DCC9',
        },
        typography: {
          headingFont:   'Fraunces',
          bodyFont:      'Inter Tight',
          baseFontSize:  15,
          headingWeight: 600,
          bodyWeight:    400,
          lineHeight:    1.6,
          letterSpacing: 0,
        },
        spacing: {
          containerMaxWidth:      1320,
          sectionVerticalPadding: 96,
          borderRadius:           0,
          cardBorderRadius:       0,
          elementGap:             20,
        },
        customCSS: '',
      },
      pages: {
        index: {
          id: 'index', name: 'Home', slug: 'index.html',
          sections: [
            // ── 1. Slim editorial announcement bar ──────────────────
            {
              id: 'd-announce', type: 'announcement-bar', visible: true, locked: true, layout: {},
              settings: {
                text: 'Complimentary worldwide shipping on orders over $200',
                linkText: 'Discover',
                linkUrl: '/products.html',
                backgroundColor: '#161310',
                textColor: '#FBF7EE',
                height: 12,
                fontSize: 11,
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 2. Centered editorial header ────────────────────────
            {
              id: 'd-header', type: 'header', visible: true, locked: true, layout: {},
              settings: {
                storeName: name,
                logoFont: 'display',
                logoLayout: 'centered',
                logoSize: 24,
                logoSpacing: '.16em',
                showCartIcon: true,
                showSearchIcon: true,
                showAccountIcon: true,
                sticky: true,
                navLinks: [
                  { label: 'New In',     url: '/products.html' },
                  { label: 'Collection', url: '/products.html' },
                  { label: 'Editorial',  url: '#' },
                ],
                navLinksRight: [
                  { label: 'Atelier', url: '#' },
                  { label: 'Journal', url: '#' },
                ],
                linkSpacing: 28,
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 3. Editorial split hero ─────────────────────────────
            {
              id: 'd-hero', type: 'hero', visible: true, layout: { width: 'full', minHeight: 680, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
              settings: {
                layout: 'split',
                kicker:        'The Spring Edit',
                issueLabel:    'Volume I',
                headline:      s.hero_title    || 'A study in',
                headlineItalic:                   'quiet luxury.',
                subheadline:   s.hero_subtitle || 'Considered pieces, photographed in natural light. Built in small runs, shipped from the studio.',
                seasonMarker:  'SS · ' + year,
                imageUrl:      'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1400&q=85&auto=format&fit=crop',
                imageAlt:      'The Spring Edit — featured campaign',
                imageCaption:  'Photographed in studio · Édition I',
                showPhotoBadge:  true,
                photoBadgeLabel: 'N°01',
                imagePlaceholderEyebrow: 'An introduction to',
                imagePlaceholderMeta:    'Volume I — Édition Studio',
                showStats:     true,
                stats: [
                  { value: '47',     label: 'New Arrivals'   },
                  { value: 'Free',   label: 'Worldwide Ship' },
                  { value: '30-Day', label: 'Returns'        },
                ],
                primaryButton:   { label: s.hero_cta || 'Shop the Edit', url: '/products.html' },
                showSecondaryButton: true,
                secondaryButton: { label: 'Read the Journal', url: '#' },
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 4. Numbered editorial features (luxury rituals) ─────
            {
              id: 'd-features', type: 'features', visible: true,
              layout: { padding: { top: 96, right: 24, bottom: 96, left: 24 }, background: { type: 'color', color: '#FBF7EE' } },
              settings: {
                columns: 3,
                eyebrow: 'The House',
                heading: 'A practice, not a product.',
                subheading: 'Three quiet promises that shape every piece we send.',
              },
              blocks: [
                { id: 'df1', type: 'feature', visible: true, settings: { heading: 'Considered Materials', description: 'Sourced from family-run mills in Italy, Portugal, and Japan.' } },
                { id: 'df2', type: 'feature', visible: true, settings: { heading: 'Made in Small Runs',    description: 'Limited editions, never restocked — rarity by intention.' } },
                { id: 'df3', type: 'feature', visible: true, settings: { heading: 'Shipped from Studio',   description: 'Hand-checked, carbon-neutral worldwide delivery within 48 hours.' } },
              ],
              customCSS: '', customClasses: '',
            },
            // ── 5. The featured edit (product grid) ─────────────────
            {
              id: 'd-products', type: 'product-grid', visible: true, layout: {},
              settings: {
                eyebrow: 'New Arrivals',
                heading: 'The Edit, Spring ' + year + '.',
                subheading: 'A curated selection — hand-photographed, dispatched from the atelier.',
                columns: 4, limit: 8, showAddToCart: true,
                showViewAll: true, viewAllText: 'See the Whole Collection', viewAllUrl: '/products.html',
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 6. Brand story (info section) ───────────────────────
            {
              id: 'd-info', type: 'info', visible: true,
              layout: { padding: { top: 96, right: 24, bottom: 96, left: 24 }, background: { type: 'color', color: '#F4EFE6' } },
              settings: {
                layout: 'image-left',
                image: 'https://images.unsplash.com/photo-1581375074612-d1fd0e661aeb?w=1100&q=85&auto=format&fit=crop',
                imageRadius: 0,
                eyebrow: 'Our Story',
                heading: 'Founded on a single, slow idea.',
                body: '<p>We began in a sunlit studio with a small loom and a deep dissatisfaction with disposable luxury. Today, every piece we make starts in the same room — drafted by hand, prototyped over weeks, refined until it disappears into the wardrobe.</p>',
                showCta: true,
                ctaButton: { label: 'Inside the Atelier', url: '#', variant: 'link', backgroundColor: 'transparent', textColor: '#161310', borderColor: '#161310', borderWidth: 0, paddingX: 0, paddingY: 4, fontSize: 11 },
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 7. Press / testimonials ─────────────────────────────
            {
              id: 'd-press', type: 'testimonials', visible: true,
              layout: { padding: { top: 96, right: 24, bottom: 96, left: 24 }, background: { type: 'color', color: '#FBF7EE' } },
              settings: {
                eyebrow: 'In The Press',
                heading: 'What people are saying.',
                showAvatar: false,
                showRating: true,
              },
              blocks: [
                { id: 'dp1', type: 'testimonial', visible: true, settings: { quote: 'A masterclass in restraint — the kind of quiet design that makes everything else look loud.', author: 'Vogue Living', role: 'Editor’s Pick',     rating: 5 } },
                { id: 'dp2', type: 'testimonial', visible: true, settings: { quote: 'Pieces that age like good wood — softer, more yours, with every season.',                          author: 'Monocle',      role: 'Issue 184',        rating: 5 } },
                { id: 'dp3', type: 'testimonial', visible: true, settings: { quote: 'Rarely do we recommend an entire collection. This is the rare exception.',                       author: 'Kinfolk',      role: 'The Style Issue',  rating: 5 } },
              ],
              customCSS: '', customClasses: '',
            },
            // ── 8. Newsletter (Le Journal) ──────────────────────────
            {
              id: 'd-newsletter', type: 'newsletter', visible: true,
              layout: { padding: { top: 96, right: 24, bottom: 96, left: 24 }, background: { type: 'color', color: '#F4EFE6' } },
              settings: {
                eyebrow: 'Le Journal',
                heading: 'Letters from the studio.',
                description: 'A monthly note on what we’re making, where we’re looking, and the rare pieces we never list publicly.',
                placeholder: 'your@email.com',
                buttonText: 'Subscribe',
                disclaimer: 'No noise. Unsubscribe anytime.',
              },
              blocks: [], customCSS: '', customClasses: '',
            },
            // ── 9. Footer (dark ink) ────────────────────────────────
            {
              id: 'd-footer', type: 'footer', visible: true, locked: true, layout: {},
              settings: {
                storeName:       name,
                aboutText:       s.store_description || 'Considered clothing for the discerning few. Crafted with precision, worn with intention.',
                copyrightText:   '© ' + year + ' ' + name + '. All rights reserved.',
                legalLineText:   'Privacy · Terms · Accessibility',
                backgroundColor: '#161310',
                textColor:       '#FBF7EE',
              },
              blocks: [
                { id: 'dfc1', type: 'footer-column', visible: true, settings: { heading: 'Shop',    links: [{ label: 'New In',         url: '/products.html' }, { label: 'Outerwear',  url: '/products.html' }, { label: 'Knitwear', url: '/products.html' }, { label: 'Gift Cards', url: '#' }] } },
                { id: 'dfc2', type: 'footer-column', visible: true, settings: { heading: 'Atelier', links: [{ label: 'Our Story',      url: '#' }, { label: 'Sustainability', url: '#' }, { label: 'Stockists', url: '#' }, { label: 'Press',     url: '#' }] } },
                { id: 'dfc3', type: 'footer-column', visible: true, settings: { heading: 'Help',    links: [{ label: 'Shipping & Returns', url: '#' }, { label: 'Size Guide', url: '#' }, { label: 'Care Instructions', url: '#' }, { label: 'Contact', url: '#' }] } },
              ],
              customCSS: '', customClasses: '',
            },
          ],
        },
      },
    };
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
        var data = body && body.ok && body.data;
        var raw  = data && data.page_sections;
        if (raw) {
          try { applySchema(JSON.parse(raw)); return; }
          catch (e) { console.error('Bad page_sections JSON:', e); }
        }
        // No saved schema (or it failed to parse) — render a polished
        // default so the storefront isn't a blank canvas.
        applySchema(buildDefaultSchema(data));
      })
      .catch(function () {
        // Network error: still render a default rather than nothing.
        applySchema(buildDefaultSchema());
      });
  }

})();
