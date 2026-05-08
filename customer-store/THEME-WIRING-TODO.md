# ARCH Theme Wiring — Editor Integration TODO

This file tracks the remaining work to make the editor in
`admin-dashboard/editor-app` actually drive the new ARCH base theme rendered by
`customer-store/index.html`. The plumbing is in place (`store-renderer.js` ships
an `ARCH_PATCHERS` map that mutates the live ARCH DOM in response to
`postMessage` from the editor or `GET /settings/public` on a customer page) but
most editor controls still have no patcher on the storefront side.

Everything below assumes the architecture from branch
`claude/fix-theme-editor-sections-kh6Mg` — start there before changing things.

---

## What's already wired

These bindings flow from the editor schema to the ARCH DOM today
(`customer-store/store-renderer.js`, `patchHeader / patchHero / patchFooter /
patchProductGrid` ~ line 442+):

- `header.settings.storeName` → every `[data-store-name]` (nav logo + footer logo).
- `header.settings.navLinks` → split across `[data-uc-bind="header.navLinks.left"]` and `[...right"]` around the centered logo.
- `header.settings.showCartIcon` → toggles `[data-uc-bind="header.cartIcon"]`.
- `hero.settings.kicker / subheadline / subheading` → `[data-uc-bind="hero.kicker"]`.
- `hero.settings.headline` (split on `.` or `titleAccent`) → `[data-uc-bind="hero.titleMain"]` + `[...titleAccent"]`.
- `hero.settings.primaryButton.{label,url}` (also `cta`, `ctaLabel`, `ctaUrl`) → `[data-uc-bind="hero.cta"]` + its `<span>`.
- `hero.settings.image` → `[data-uc-bind="hero.image"]` `src`.
- `hero.settings.season` → `[data-uc-bind="hero.text"][data-season]`.
- `hero.settings.stats[]` → `[data-uc-bind="hero.stats"]` (rendered as `.hero-stat` blocks; empty array hides the strip).
- `footer.settings.aboutText / tagline` → `[data-uc-bind="footer.tagline"]`.
- `footer.settings.copyrightText` → `[data-uc-bind="footer.copyright"]`.
- `footer.blocks[type=footer-column]` (first 3) → `[data-uc-bind="footer.col1|col2|col3"]`.
- Per-section `visible:false` → `display:none` on the ARCH slot.
- `globalTheme.colors / typography / spacing` → CSS vars injected via `<style id="uc-theme-vars">` (still read by editor presets, NOT by ARCH's `--bg / --ink / --accent` — see "Theme system overlap" below).

The product grid slot has a stub patcher only — see next section.

---

## Section settings that need wiring

For each ARCH slot, here are the `defaultSettings` keys defined in
`admin-dashboard/editor-app/src/registry.ts` that have NO matching write in
`store-renderer.js`. Format: `setting → DOM target / behavior`.

### header (registry.ts L84-118)

- `logoUrl` → if present, swap `[data-uc-bind="header.storeName"]` text for an `<img>` (or render alongside `data-store-name`). Today logo image is dropped.
- `textColor` → set CSS var (e.g. `nav.uc-nav { color: <value> }` via inline style or scoped `<style>`). Currently ignored.
- `sticky` → already CSS-positioned `fixed`; need to honor `sticky:false` by toggling a class that drops `position:fixed` and the body padding compensation.
- `transparent` → toggle a `.is-transparent` class on `[data-uc-section="header"]`; pair with a scroll listener that removes it once `scrollY > 8`. Today the nav is always solid `var(--white)`.
- `layout.background` → write to `nav.uc-nav` background-color/image. Currently only `globalTheme` colors apply.

### hero (registry.ts L121-171)

- `headlineTypography` (font size / weight / color / align) → inline style on `.hero-title` and its spans.
- `subheadlineTypography` → inline style on `.hero-kicker`.
- `primaryButton` style fields beyond `label/url`: `backgroundColor`, `textColor`, `hoverBackgroundColor` → scoped `<style>` keyed off the section id, or inline style + CSS-var fallback for hover.
- `showSecondaryButton` + `secondaryButton` → ARCH currently has only one CTA. Add a sibling `[data-uc-bind="hero.secondaryCta"]` markup in `index.html` and patch it (or inject when toggle is true).
- `contentMaxWidth` → inline style on `.hero-text` width.
- `showScrollIndicator` → render/hide a scroll arrow at the bottom of `.hero` (no markup exists yet).
- `layout.background` (`type:image`, gradient, etc.) → ARCH's hero uses a fixed `<img data-uc-bind="hero.image">`. Decide if `layout.background` overrides that image or is ignored for hero.
- `layout.minHeight` / `layout.padding` → write to `.hero` element.
- `layout.contentAlign` → already has `left` baked in; honor `center / right`.

### product-grid (registry.ts L174-222)

`patchProductGrid` is currently a one-line stub (`setVisible` only). All of
these need to flow into ARCH's `.products-section` markup AND into the inline
JS that owns the grid (see "ARCH inline JS" section).

- `heading` → there is no heading element above `.products-section` today; either add `[data-uc-bind="product-grid.heading"]` to `index.html` or render one from JS.
- `subheading` → same as above.
- `columns` (2/3/4) → set `grid-template-columns` on `.products-grid`.
- `limit` → currently ignored; the ARCH inline JS hardcodes 24 fallback products. Pass to the products fetch / slice.
- `showPrice` → toggle `.product-price` visibility.
- `showAddToCart` → ARCH has no per-card add button today; either add one to the card template in `index.html` or skip.
- `imageAspectRatio` (`1/1` / `3/4` / `4/3`) → set `aspect-ratio` on `.product-image`.
- `cardBorderRadius` → `border-radius` on `.product-card`.
- `showViewAll` + `viewAllText` + `viewAllUrl` → render a "View all" link below the grid (no slot in `index.html` yet).

### footer (registry.ts L765-825)

- `logoUrl` → swap `.footer-logo` text for an image when set.
- `showSocial` + `socialLinks.{instagram,twitter,facebook,tiktok,youtube}` → render an icon row inside the footer (ARCH's footer has no social row markup yet — add one with `[data-uc-bind="footer.social"]`).
- `copyrightColor` → inline style on `[data-uc-bind="footer.copyright"]`.
- `layout.background` / `layout.padding` → write to `footer.uc-footer`.
- The `footer-column` block field is `heading` in `registry.ts` (L819) but `patchFooter` reads `bs.title`. **Pick one.** Today columns render with empty headings unless you author them with `title`.

---

## Editor-only sections that need new ARCH slots

Everything not in `ARCH_PATCHERS` (`header / nav / hero / footer /
product-grid`) currently falls through to the legacy `RENDERERS` map and gets
appended into `<div id="uc-extra-sections">` between hero and product grid.
That works structurally but the markup is generic — no ARCH typography, no
beige/dark/gold palette, no `.uc-nav`-style spacing — so these sections look
out of place on the rendered page.

Each of the following needs an ARCH-styled patcher (or a re-themed renderer
specifically for ARCH; either approach is fine, but the patcher path matches
how the four core slots work):

- `gallery` (registry.ts L264-326) — grid/masonry/carousel of `gallery-image` blocks. ARCH equivalent: large image grid in Bodoni-bordered frames.
- `testimonials` (L328-391) — quote blocks. Should use Bodoni serif italic for quotes, `--accent` rule above the name.
- `features` (L436-492) — icon-grid of value props. Render with thin gold dividers, Instrument Sans labels.
- `categories` (L494-549) — image cards linking to collections. Match `.product-card` aspect ratio + serif heading style.
- `faq` (L590-638) — accordion. ARCH has no accordion CSS yet; re-use `--border` lines and `var(--f-display)` for questions.
- `info` (L393-434) — text + image two-column. Use ARCH `--bg` / `--ink` and the editorial line-height of `.hero-text`.
- `newsletter` (L551-588) — email signup. Match the hidden-border input style of the search bar.
- `video` (L670-709) — youtube/vimeo embed; preserve aspect ratio, add an ARCH-themed caption row.
- `rich-text` (L640-668) — generic prose. At minimum scope it under `.uc-prose` so headings pick up Bodoni Moda.
- `announcement-bar` (L56-81) — already works as a thin top bar; just re-skin to use `var(--ink)` background and `var(--white)` text by default so it stacks above `.uc-nav`.
- `product-carousel` (L225-262) — needs ARCH product-card markup with horizontal scroll + arrow buttons that match `.qv-nav` styling.
- `spacer`, `divider`, `custom` — fine as-is, but `divider` should default to `var(--border)`.

Implementation suggestion: extend `ARCH_PATCHERS` so a section type can either
target an existing slot OR mount its own ARCH-styled subtree into
`#uc-extra-sections`. That keeps the two-pass render in `applySchema` simple.

---

## ARCH inline JS that needs API wiring

`customer-store/index.html` ships a self-contained `<script>` block that owns
the products grid, sidebar filters, search/sort, pagination, cart, and
quick-view. Today it's almost entirely client-side and disconnected from
`customer-store/cart.js` / the backend. The pieces that need real wiring:

- **Products fetch** — already calls `GET /products` with a placeholder fallback. Honor `product-grid.settings.limit` and any future filter querystring (`?category=`, `?sort=`).
- **Sidebar filters** — currently visual-only. Selected categories / price range / sizes / colors should rebuild the query (or filter client-side over the loaded array, but in a way that respects pagination).
- **Search bar** — filters the in-memory `PRODUCTS` array on keystroke. For real catalogs this should hit `GET /products?q=` (debounced) instead.
- **Sort dropdown** — same: server-side `?sort=price-asc|price-desc|newest` instead of client sort.
- **Pagination** — 8 hardcoded page buttons with no actual paging. Replace with real page count from API response (`x-total-count` or similar) and `?page=` queries.
- **Cart** — completely in-memory in `index.html` (`let cart = []`). Replace with the existing module in `customer-store/cart.js` (localStorage state + `POST /cart` calls). The cart drawer's open / close UI can stay; only the data layer changes.
- **Quick-view modal** — uses static product images and an in-page array. Should fetch the full product (variants, multi-image gallery) on open. Also fire an analytics event so `quick view → add to cart` is trackable.
- **Checkout button** — currently shows a toast `Proceeding to checkout...`. Should `POST /cart/checkout`, then `window.location = response.url` (Stripe Checkout URL).
- **Newsletter form in footer** (if/when added) — `POST /subscribers` instead of an alert.

Practical move: lift the inline `<script>` out of `index.html` into a new
`customer-store/storefront.js` so it can `import` from `cart.js` and stay
testable.

---

## Editor preview iframe — smoke test

The patch path is built but hasn't been exercised end-to-end. Verify in the
running editor:

- Loading the editor mounts `customer-store/index.html` in the preview iframe and `bst:ready` fires (check console).
- Editing the hero headline / kicker / CTA in the right panel updates the ARCH DOM live (no flicker — `setText` already guards against unchanged values).
- Reordering sections in the left panel re-runs `applySchema`; ARCH slots stay put while `#uc-extra-sections` re-renders in declaration order.
- Toggling `visible:false` on the header / hero / footer hides the ARCH slot rather than orphaning it.
- A fresh save → reload (no editor) lands on the same rendered page via `GET /settings/public` (the standalone load path at the bottom of `store-renderer.js`).

If any of those break, the bug is most likely in `applySchema` ordering or in
the patcher reading the wrong settings key (the registry uses
`subheadline / aboutText / copyrightText`; older patchers read
`subheading / tagline / copyright` — both are accepted today but check both
paths before changing one).

---

## Theme system overlap

Two parallel CSS-var systems coexist and neither sees the other:

- **Editor `globalTheme` presets** (`base | mono | minimal | boutique | bold | studio`) inject `--uc-bg / --uc-text / --uc-accent / --uc-radius / --uc-font-*` via `<style id="uc-theme-vars">` written by `applySchema`.
- **ARCH theme** defines `--bg / --ink / --muted / --accent / --accent-d / --border / --white / --f-display / --f-body` directly in `:root` inside `index.html`.

Result: the editor's color picker / theme preset has no effect on the rendered
ARCH palette. Two ways to fix this — pick one, don't ship both:

1. **Drop the editor presets** for ARCH-based stores and surface ARCH's own knobs (background / ink / accent / border / display font / body font) as native settings in the editor's Theme panel.
2. **Wire presets into ARCH** (preferred). Add an "ARCH" preset to the editor's preset list, and in `index.html`'s `:root`, default each ARCH var to the matching `--uc-*` with a literal fallback:
   ```
   --bg:     var(--uc-bg, #F5F2EC);
   --ink:    var(--uc-text, #1A1710);
   --accent: var(--uc-accent, #C8A96E);
   --f-display: var(--uc-heading-font, 'Bodoni Moda', serif);
   --f-body:    var(--uc-body-font, 'Instrument Sans', sans-serif);
   ```
   Then the editor's color pickers actually drive the page, and the ARCH
   preset just ships sensible defaults.

The font-loading helper `loadGoogleFont` in `store-renderer.js` already pulls
in heading/body fonts from `globalTheme.typography`, so option 2 is mostly a
one-file CSS change in `index.html` plus an "ARCH" entry in the editor's
preset registry.

---

## Provisioning

`provisioning-service/src/defaults/store-schema.ts` was updated with
ARCH-flavored copy for the seeded `page_sections` JSON. To verify:

- Provision a fresh tenant.
- Visit the storefront — the page should land on populated ARCH copy (hero kicker, season marker, populated stats, footer columns), NOT the legacy "Welcome to Our Store" placeholders.
- Open the editor for that tenant — the left panel should show the ARCH-flavored sections in the right order, and editing them should patch the live preview (see iframe smoke test above).

If a fresh tenant comes up with placeholder text, the seed JSON in
`store-schema.ts` is being overridden somewhere downstream (check the
provisioning bootstrap and any "first-load" defaults in the editor).

---

## Future work (out of scope here)

These are not part of the editor → ARCH wiring effort. List them so the next
engineer doesn't think they're missing:

- Pagination wiring beyond the cosmetic page buttons.
- Product variant selection (size / color swatches from real variant data).
- Wishlist / save-for-later.
- Account pages (login, order history, addresses).
- Multi-page support in the editor (today only the index page is exercised).
- Accessibility audit (focus rings, keyboard nav of the cart drawer + quick-view modal, ARIA on the filter sidebar).
- Mobile breakpoint pass on the new `#uc-extra-sections` blocks once they have ARCH styling.
- Performance: defer the inline script in `index.html` once it's extracted; lazy-load product images below the fold.
