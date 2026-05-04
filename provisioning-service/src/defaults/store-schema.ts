// Default store schema seeded into a brand-new tenant's `store_settings`
// (`page_sections` key). Mirrors the seed produced by the editor's
// `makeDefaultSchema()` in admin-dashboard/editor-app/src/store.ts so that
// merchants land in the editor with the same sections their storefront is
// already serving.
//
// This file is the storefront's *visual default* — every property the
// renderer reads has to be present here, otherwise freshly-provisioned
// tenants render against the renderer's `||`-fallbacks and look unstyled
// (Times New Roman, default-link CTAs). Keep this in sync with the
// `defaultLayout` / `defaultSettings` blocks in
// admin-dashboard/editor-app/src/registry.ts.

// Mirror of editor's DEFAULT_GLOBAL_THEME — duplicated rather than imported
// to keep this service free of cross-app TS path resolution.
const DEFAULT_GLOBAL_THEME = {
  preset: 'base',
  colors: {
    primary:     '#111111',
    primaryText: '#ffffff',
    secondary:   '#555555',
    accent:      '#f5c000',
    background:  '#ffffff',
    surface:     '#f5f5f5',
    text:        '#111111',
    textMuted:   '#888888',
    border:      'rgba(0,0,0,0.1)',
  },
  typography: {
    // System font stack instead of 'inherit' — the renderer maps both to a
    // real stack but having a real value here means the editor's Theme panel
    // shows the merchant what they're starting from.
    headingFont:   'system',
    bodyFont:      'system',
    baseFontSize:  16,
    headingWeight: 700,
    bodyWeight:    400,
    lineHeight:    1.6,
    letterSpacing: 0,
  },
  spacing: {
    containerMaxWidth:      1200,
    sectionVerticalPadding: 80,
    borderRadius:           4,
    cardBorderRadius:       4,
    elementGap:             16,
  },
  customCSS: '',
};

const DEFAULT_BACKGROUND = {
  type:               'color',
  color:              '#ffffff',
  gradientFrom:       '#ffffff',
  gradientTo:         '#f0f0f0',
  gradientAngle:      135,
  gradientType:       'linear',
  imageUrl:           '',
  videoUrl:           '',
  overlayColor:       '#000000',
  overlayOpacity:     0.4,
  parallax:           false,
  backgroundSize:     'cover',
  backgroundPosition: 'center center',
};

const DEFAULT_SPACING = { top: 0, right: 0, bottom: 0, left: 0 };

// ── Section-wrapper layouts ──────────────────────────────────────────────
// These mirror admin-dashboard/editor-app/src/registry.ts so the defaults
// the merchant sees in the editor match exactly what the storefront paints.

const HEADER_LAYOUT = {
  width:        'full',
  padding:      { top: 0, right: 24, bottom: 0, left: 24 },
  margin:       { ...DEFAULT_SPACING },
  background:   { ...DEFAULT_BACKGROUND, color: '#ffffff' },
  minHeight:    0,
  contentAlign: 'left',
};

const HERO_LAYOUT = {
  width:        'full',
  padding:      { top: 120, right: 40, bottom: 120, left: 40 },
  margin:       { ...DEFAULT_SPACING },
  background:   { ...DEFAULT_BACKGROUND, type: 'color', color: '#1a1a1a' },
  minHeight:    480,
  contentAlign: 'left',
};

const SECTION_LAYOUT = {
  width:        'contained',
  padding:      { top: 80, right: 24, bottom: 80, left: 24 },
  margin:       { ...DEFAULT_SPACING },
  background:   { ...DEFAULT_BACKGROUND, color: '#ffffff' },
  minHeight:    0,
  contentAlign: 'left',
};

// ── Default button styles ────────────────────────────────────────────────
// Without these, the hero CTA renders as a default underlined `<a>`.

const DEFAULT_BUTTON = {
  label:                'Button',
  url:                  '#',
  openInNewTab:         false,
  variant:              'solid',
  size:                 'md',
  backgroundColor:      '#111111',
  textColor:            '#ffffff',
  borderColor:          '#111111',
  borderRadius:         4,
  borderWidth:          0,
  paddingX:             28,
  paddingY:             14,
  fontSize:             14,
  fontWeight:           600,
  shadow:               'none',
  hoverBackgroundColor: '#333333',
  hoverTextColor:       '#ffffff',
  fullWidth:            false,
};

export const DEFAULT_STORE_SCHEMA = {
  version: '2.0',
  globalTheme: DEFAULT_GLOBAL_THEME,
  pages: {
    index: {
      id:   'index',
      name: 'Home',
      icon: 'Home',
      slug: 'index.html',
      sections: [
        {
          id:            'seed-header',
          type:          'header',
          label:         'Header',
          visible:       true,
          locked:        true,
          layout:        HEADER_LAYOUT,
          settings:      {
            storeName:        'My Store',
            logoUrl:          '',
            logoFont:         'system',
            showCartIcon:     true,
            showSearchIcon:   true,
            showAccountIcon:  false,
            showWishlistIcon: false,
            showHamburger:    true,
            navLinks: [
              { label: 'Shop',  url: '/products' },
              { label: 'About', url: '#'         },
            ],
            sticky:      true,
            transparent: false,
            textColor:   '#111111',
            height:      64,
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-hero',
          type:          'hero',
          label:         'Hero Banner',
          visible:       true,
          locked:        false,
          layout:        HERO_LAYOUT,
          settings:      {
            headline:    'Welcome to Our Store',
            subheadline: 'Discover our curated collection of premium products.',
            primaryButton: {
              ...DEFAULT_BUTTON,
              label:           'Shop Now',
              url:             '/products',
              backgroundColor: '#ffffff',
              textColor:       '#111111',
              borderColor:     '#ffffff',
            },
            showSecondaryButton: false,
            secondaryButton: {
              ...DEFAULT_BUTTON,
              label:           'Learn More',
              url:             '#',
              variant:         'outline',
              backgroundColor: 'transparent',
              textColor:       '#ffffff',
              borderColor:     '#ffffff',
              borderWidth:     1,
            },
            contentMaxWidth:    640,
            headingColor:       '#ffffff',
            subheadingColor:    'rgba(255,255,255,0.85)',
            headingSize:        64,
            subheadingSize:     20,
            textAlign:          'left',
            verticalAlign:      'center',
            minHeight:          480,
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-gallery',
          type:          'gallery',
          label:         'Gallery',
          visible:       true,
          locked:        false,
          layout:        SECTION_LAYOUT,
          settings:      {
            heading:      'Our Gallery',
            layout:       'grid',
            columns:      3,
            gap:          8,
            imageRadius:  0,
            aspectRatio:  '1/1',
            lightbox:     true,
            showCaptions: false,
          },
          blocks: [
            { id: 'seed-gallery-block-0', type: 'gallery-image', visible: true,
              settings: { url: '', alt: '', caption: '' } },
            { id: 'seed-gallery-block-1', type: 'gallery-image', visible: true,
              settings: { url: '', alt: '', caption: '' } },
            { id: 'seed-gallery-block-2', type: 'gallery-image', visible: true,
              settings: { url: '', alt: '', caption: '' } },
          ],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-footer',
          type:          'footer',
          label:         'Footer',
          visible:       true,
          locked:        true,
          layout:        {
            ...SECTION_LAYOUT,
            background: { ...DEFAULT_BACKGROUND, color: '#111111' },
            padding:    { top: 60, right: 24, bottom: 36, left: 24 },
          },
          settings:      {
            copyrightText: '© My Store. All rights reserved.',
            backgroundColor: '#111111',
            textColor:       '#ffffff',
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
      ],
    },
  },
} as const;
