// Default store schema seeded into a brand-new tenant's `store_settings`
// (`page_sections` key). Mirrors the seed produced by the editor's
// `makeDefaultSchema()` in admin-dashboard/editor-app/src/store.ts so that
// merchants land in the editor with the same sections their storefront is
// already serving.
//
// Settings are intentionally sparse — the storefront renderer's
// `||`-fallback defaults produce visible placeholder content for any field
// that is missing. As soon as the merchant saves from the editor, this
// stub is replaced with the registry-driven full schema.

// Mirror of editor's DEFAULT_GLOBAL_THEME — duplicated rather than imported
// to keep this service free of cross-app TS path resolution. The shape only
// needs to satisfy the storefront renderer's `themeToCssVars()`.
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
    headingFont:   'inherit',
    bodyFont:      'inherit',
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
          layout:        {},
          settings:      {
            storeName:    'ARCH',
            showCartIcon: true,
            sticky:       true,
            navLinks: [
              { label: 'Women',       url: '/products?cat=women' },
              { label: 'Men',         url: '/products?cat=men'   },
              { label: 'Collections', url: '/products?cat=new'   },
              { label: 'Sale',        url: '/products?cat=sale'  },
              { label: 'About',       url: '/about'              },
            ],
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
          layout:        {},
          settings:      {
            subheadline:   'New Season Arrivals',
            headline:      'The Coat Issue.',
            season:        'SS 26',
            image:         'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=85&auto=format&fit=crop',
            primaryButton: { label: 'Shop Outerwear', url: '/products' },
            stats: [
              { value: '47',   label: 'New Arrivals'       },
              { value: 'Free', label: 'Shipping Over $200' },
              { value: '30d',  label: 'Returns'            },
            ],
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
          layout:        {},
          settings:      {
            heading: 'Our Gallery',
            columns: 3,
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-footer',
          type:          'footer',
          label:         'Footer',
          visible:       true,
          locked:        true,
          layout:        {},
          settings:      {
            aboutText:     'Considered clothing for the discerning mind. Crafted with precision, worn with intention.',
            copyrightText: '© 2026 ARCH. All rights reserved.',
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
      ],
    },
  },
} as const;
