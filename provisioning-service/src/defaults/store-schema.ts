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
            storeName:    'My Store',
            showCartIcon: true,
            navLinks: [
              { label: 'Shop',  url: '/products.html' },
              { label: 'About', url: '#'              },
            ],
            sticky: true,
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
            headline:      'Made for everyday',
            subheadline:   'A modern collection of essentials, designed to last and built around the way you live.',
            kicker:        'New Collection',
            primaryButton: { label: 'Shop the Collection', url: '/products.html' },
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-features',
          type:          'features',
          label:         'Features',
          visible:       true,
          locked:        false,
          layout:        {},
          settings:      {
            columns: 3,
            cardStyle: 'plain',
            cardAlign: 'center',
          },
          blocks: [
            { id: 'f1', type: 'feature', visible: true, settings: { heading: 'Free Shipping',  description: 'On every order over $75 — no codes required.', icon: 'Truck'  } },
            { id: 'f2', type: 'feature', visible: true, settings: { heading: 'Easy Returns',   description: '30-day no-questions returns on anything you buy.', icon: 'RotateCcw' } },
            { id: 'f3', type: 'feature', visible: true, settings: { heading: 'Secure Checkout', description: 'Encrypted payments processed through Stripe.', icon: 'Lock'   } },
          ],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-products',
          type:          'product-grid',
          label:         'Featured Products',
          visible:       true,
          locked:        false,
          layout:        {},
          settings:      {
            heading: 'New Arrivals',
            subheading: 'A curated selection of our latest pieces.',
            columns: 4,
            limit:   8,
            showAddToCart: true,
          },
          blocks:        [],
          customCSS:     '',
          customClasses: '',
        },
        {
          id:            'seed-newsletter',
          type:          'newsletter',
          label:         'Newsletter',
          visible:       true,
          locked:        false,
          layout:        {},
          settings:      {
            heading:     'Join the list',
            description: 'Be first to hear about new arrivals, restocks, and exclusive offers.',
            buttonText:  'Subscribe',
            placeholder: 'you@example.com',
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
            aboutText:     'A modern, thoughtfully made collection — shipped fast and built to last.',
            copyrightText: '© My Store. All rights reserved.',
          },
          blocks: [
            { id: 'fc1', type: 'footer-column', visible: true, settings: { heading: 'Shop',    links: [{ label: 'All Products', url: '/products.html' }, { label: 'New Arrivals', url: '/products.html' }] } },
            { id: 'fc2', type: 'footer-column', visible: true, settings: { heading: 'Help',    links: [{ label: 'Contact',      url: '#' }, { label: 'Shipping',     url: '#' }, { label: 'Returns', url: '#' }] } },
            { id: 'fc3', type: 'footer-column', visible: true, settings: { heading: 'Company', links: [{ label: 'About',        url: '#' }, { label: 'Journal',      url: '#' }] } },
          ],
          customCSS:     '',
          customClasses: '',
        },
      ],
    },
  },
} as const;
