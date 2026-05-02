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
        .map(l => `<a href="${l.url||'#'}" class="uc-nav-link" style="color:${s.linkColor||s.textColor||'inherit'};font-size:${s.linkSize||14}px;text-decoration:none">${l.label||''}</a>`)
        .join('');
      const storeName = s.storeName || s.logoAlt || 'My Store';
      return `<header class="uc-header" style="background:${s.backgroundColor||'var(--uc-bg)'};color:${s.textColor||'var(--uc-text)'};border-bottom:${s.borderBottom?'1px solid var(--uc-border)':'none'};position:${s.sticky?'sticky':'relative'};top:0;z-index:100;">
        <div class="uc-container uc-w-contained" style="display:flex;align-items:center;gap:24px;height:${s.height||64}px">
          ${s.logoUrl ? `<img src="${s.logoUrl}" alt="${storeName}" style="height:${s.logoHeight||40}px;width:auto">` : `<span style="font-weight:700;font-size:20px">${storeName}</span>`}
          <nav style="display:flex;align-items:center;gap:${s.linkSpacing||24}px;margin-left:auto">${links}</nav>
          ${s.showCartIcon ? `<a href="/cart" aria-label="Cart" style="margin-left:12px;color:inherit;text-decoration:none;font-size:18px">🛒</a>` : ''}
        </div>
      </header>`;
    },

    'hero': (sec) => {
      const s = sec.settings;
      const mediaHtml = s.mediaType === 'video' && s.videoUrl
        ? `<video src="${s.videoUrl}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0"></video>`
        : s.imageUrl ? `<img src="${s.imageUrl}" alt="${s.imageAlt||''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0">` : '';
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

  /* ── Main render ──────────────────────────────────────────────────────── */

  let currentSchema = null;
  let styleEl = null;
  let mainEl  = null;

  function applySchema(schema) {
    currentSchema = schema;

    // ── Global CSS vars ────────────────────────────────────────────────
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'uc-theme-vars';
      document.head.appendChild(styleEl);
    }
    const theme = schema.globalTheme;
    styleEl.textContent = `:root { ${themeToCssVars(theme)} }\n` +
      `body { background: var(--uc-bg); color: var(--uc-text); font-family: var(--uc-body-font); font-size: var(--uc-base-font-size); line-height: var(--uc-line-height); }\n` +
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
      (theme.customCSS || '');

    // Load Google Fonts
    loadGoogleFont(theme.typography.headingFont);
    loadGoogleFont(theme.typography.bodyFont);

    // ── Render page sections ───────────────────────────────────────────
    const pageId = Object.keys(schema.pages)[0] || 'index';
    const page   = schema.pages[pageId];
    if (!page) return;

    // Find or create main content area
    if (!mainEl) {
      // Try to find existing content area or use body
      mainEl = document.getElementById('uc-editor-canvas');
      if (!mainEl) {
        mainEl = document.createElement('div');
        mainEl.id = 'uc-editor-canvas';
        document.body.appendChild(mainEl);
      }
    }

    const html = page.sections
      .filter(sec => sec.visible !== false)
      .map(sec => {
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
      })
      .join('\n');

    mainEl.innerHTML = html;
  }

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
