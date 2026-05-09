/* =================================================================
   Upcart Store Editor — Section Registry
   Single source of truth for all section types.
   The editor reads this to build the Section Library and the
   contextual Properties Panel.  The storefront renderer uses the
   same type keys to know how to render each section.
================================================================= */

import type {
  SectionDef, SectionType,
  Background, Spacing,
} from './types';
import {
  DEFAULT_BACKGROUND as BG,
  DEFAULT_SPACING as SP,
  SECTION_PADDING as PAD,
  DEFAULT_BUTTON as BTN,
  DEFAULT_TYPOGRAPHY as TYPO,
} from './types';

// ── Shared default values ─────────────────────────────────────────────────

const whiteBg: Background   = { ...BG, color: '#ffffff' };
const darkBg:  Background   = { ...BG, color: '#111111' };
const surfaceBg: Background = { ...BG, color: '#f5f5f5' };

function sectionPad(v = 80, h = 24): Spacing { return { top: v, right: h, bottom: v, left: h }; }

const LAYOUT_FIELDS = [
  { key: 'layout__width',        label: 'Section width',    type: 'select' as const,
    options: [
      { value: 'full',      label: 'Full width'  },
      { value: 'wide',      label: 'Wide'        },
      { value: 'contained', label: 'Contained'   },
      { value: 'narrow',    label: 'Narrow'      },
    ],
    group: 'Layout' },
  { key: 'layout__contentAlign', label: 'Content alignment', type: 'select' as const,
    options: [
      { value: 'left',   label: 'Left'   },
      { value: 'center', label: 'Center' },
      { value: 'right',  label: 'Right'  },
    ],
    group: 'Layout' },
  { key: 'layout__padding',      label: 'Padding',       type: 'spacing'    as const, group: 'Layout' },
  { key: 'layout__background',   label: 'Background',    type: 'background' as const, group: 'Layout' },
  { key: 'layout__minHeight',    label: 'Min height (px)', type: 'number'   as const, min: 0, max: 1200, group: 'Layout' },
  { key: 'customCSS',            label: 'Custom CSS',    type: 'custom-css' as const, group: 'Advanced' },
];

// ── Registry ───────────────────────────────────────────────────────────────

const REGISTRY: Record<SectionType, SectionDef> = {

  // ── Announcement Bar ───────────────────────────────────────────────────
  'announcement-bar': {
    type:        'announcement-bar',
    name:        'Announcement Bar',
    description: 'Thin banner for promotions, shipping notices, or announcements.',
    icon:        'Megaphone',
    category:    'structure',
    defaultSettings: {
      text:      'Free shipping on all orders over $50 🎉',
      textColor: '#ffffff',
      linkText:  '',
      linkUrl:   '',
    },
    defaultLayout: {
      padding:    { top: 10, right: 24, bottom: 10, left: 24 },
      background: { ...darkBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'text',      label: 'Message',   type: 'text',  placeholder: 'Your announcement…' },
      { key: 'textColor', label: 'Text color', type: 'color' },
      { key: 'linkText',  label: 'Link text (optional)', type: 'text' },
      { key: 'linkUrl',   label: 'Link URL',  type: 'url' },
      ...LAYOUT_FIELDS,
    ],
    locked: true,
  },

  // ── Header ────────────────────────────────────────────────────────────
  header: {
    type:        'header',
    name:        'Header',
    description: 'Navigation bar with logo, links, and shop icons.',
    icon:        'PanelTop',
    category:    'structure',
    defaultSettings: {
      storeName:       'My Store',
      logoUrl:         '',
      // The header ships with a basic system-font wordmark by default. Merchants
      // pick a display font from the global theme; they shouldn't need to fight
      // a stylized default to get a plain logo.
      logoFont:        'system',           // 'system' | 'display'
      showCartIcon:    true,
      showSearchIcon:  true,
      showAccountIcon: false,
      showWishlistIcon: false,
      showHamburger:   true,               // mobile-only menu toggle
      navLinks:        [
        { label: 'Shop',  url: '/products' },
        { label: 'About', url: '#'         },
      ],
      sticky:          true,
      transparent:     false,
      textColor:       '#111111',
    },
    defaultLayout: {
      width:      'full',
      padding:    { top: 0, right: 24, bottom: 0, left: 24 },
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'storeName',    label: 'Store name',    type: 'text'   },
      { key: 'logoUrl',      label: 'Logo image',    type: 'image'  },
      { key: 'logoFont',     label: 'Logo font',     type: 'select',
        options: [
          { value: 'system',  label: 'System (basic)' },
          { value: 'display', label: 'Display font'   },
        ] },
      { key: 'textColor',    label: 'Nav text color', type: 'color' },
      { key: 'sticky',       label: 'Sticky header', type: 'toggle' },
      { key: 'transparent',  label: 'Transparent on page top', type: 'toggle' },
      { key: 'showSearchIcon',   label: 'Show search icon',   type: 'toggle' },
      { key: 'showAccountIcon',  label: 'Show account icon',  type: 'toggle' },
      { key: 'showWishlistIcon', label: 'Show wishlist icon', type: 'toggle' },
      { key: 'showCartIcon',     label: 'Show cart icon',     type: 'toggle' },
      { key: 'showHamburger',    label: 'Show mobile menu',   type: 'toggle' },
      { key: 'layout__background', label: 'Background', type: 'background', group: 'Layout' },
      { key: 'customCSS',    label: 'Custom CSS', type: 'custom-css', group: 'Advanced' },
    ],
    locked: true,
  },

  // ── Hero Banner ───────────────────────────────────────────────────────
  hero: {
    type:        'hero',
    name:        'Hero Banner',
    description: 'Full-width banner with headline, subheadline, and CTA buttons.',
    icon:        'LayoutTemplate',
    category:    'content',
    defaultSettings: {
      headline:    'Welcome to Our Store',
      subheadline: 'Discover our curated collection of premium products.',
      headlineTypography: {
        ...TYPO, fontSize: 52, fontWeight: 700, color: '#ffffff', textAlign: 'left',
      },
      subheadlineTypography: {
        ...TYPO, fontSize: 20, fontWeight: 400, color: 'rgba(255,255,255,0.8)', textAlign: 'left',
      },
      primaryButton: {
        ...BTN, label: 'Shop Now', url: '/products', backgroundColor: '#ffffff', textColor: '#111111',
        hoverBackgroundColor: '#f0f0f0',
      },
      showSecondaryButton: false,
      secondaryButton: {
        ...BTN, label: 'Learn More', url: '#', variant: 'outline',
        backgroundColor: 'transparent', textColor: '#ffffff', borderColor: '#ffffff',
        hoverBackgroundColor: 'rgba(255,255,255,0.1)',
      },
      contentMaxWidth:  640,
      showScrollIndicator: false,
    },
    defaultLayout: {
      width:      'full',
      padding:    { top: 120, right: 40, bottom: 120, left: 40 },
      // Default is a clean dark surface — no remote image URL so the base
      // theme never ships with a broken hot-linked image. Merchants opt in
      // to a hero photo via the editor.
      background: {
        ...BG, type: 'color', color: '#1a1a1a',
      },
      minHeight:  480,
      contentAlign: 'left',
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'headline',     label: 'Headline',    type: 'text', placeholder: 'Welcome…' },
      { key: 'subheadline',  label: 'Subheadline', type: 'textarea', placeholder: 'Short description…' },
      { key: 'primaryButton',      label: 'Primary button',    type: 'button-style' },
      { key: 'showSecondaryButton', label: 'Show secondary button', type: 'toggle' },
      { key: 'secondaryButton',    label: 'Secondary button',   type: 'button-style',
        condition: { key: 'showSecondaryButton', value: true } },
      { key: 'headlineTypography',    label: 'Headline style',    type: 'typography', group: 'Typography' },
      { key: 'subheadlineTypography', label: 'Subheadline style', type: 'typography', group: 'Typography' },
      { key: 'contentMaxWidth', label: 'Content max width (px)', type: 'number', min: 320, max: 1200, group: 'Layout' },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Product Grid ──────────────────────────────────────────────────────
  'product-grid': {
    type:        'product-grid',
    name:        'Product Grid',
    description: 'Display products in a responsive grid.',
    icon:        'LayoutGrid',
    category:    'commerce',
    defaultSettings: {
      heading:          'Featured Products',
      subheading:       '',
      columns:          3,
      limit:            6,
      showPrice:        true,
      showAddToCart:    false,
      imageAspectRatio: '3/4',
      cardBorderRadius: 4,
      showViewAll:      true,
      viewAllText:      'View All Products',
      viewAllUrl:       '/products',
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'heading',    label: 'Section heading', type: 'text' },
      { key: 'subheading', label: 'Subheading',      type: 'text' },
      { key: 'columns',    label: 'Columns',         type: 'select',
        options: [
          { value: '2', label: '2 columns' },
          { value: '3', label: '3 columns' },
          { value: '4', label: '4 columns' },
        ] },
      { key: 'limit',      label: 'Products to show', type: 'slider', min: 2, max: 24, step: 2 },
      { key: 'imageAspectRatio', label: 'Image aspect ratio', type: 'select',
        options: [
          { value: '1/1',  label: 'Square (1:1)'   },
          { value: '3/4',  label: 'Portrait (3:4)' },
          { value: '4/3',  label: 'Landscape (4:3)'},
        ] },
      { key: 'showPrice',       label: 'Show price',        type: 'toggle' },
      { key: 'showAddToCart',   label: 'Show Add to Cart',  type: 'toggle' },
      { key: 'cardBorderRadius', label: 'Card border radius', type: 'slider', min: 0, max: 24 },
      { key: 'showViewAll',     label: 'Show "View All" button', type: 'toggle' },
      { key: 'viewAllText',     label: 'View all text', type: 'text',
        condition: { key: 'showViewAll', value: true } },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Product Carousel ──────────────────────────────────────────────────
  'product-carousel': {
    type:        'product-carousel',
    name:        'Product Carousel',
    description: 'Horizontally scrollable product showcase.',
    icon:        'GalleryHorizontal',
    category:    'commerce',
    defaultSettings: {
      heading:          'New Arrivals',
      limit:            8,
      autoplay:         false,
      autoplayInterval: 4000,
      showArrows:       true,
      showDots:         true,
      imageAspectRatio: '3/4',
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'heading',    label: 'Heading', type: 'text' },
      { key: 'limit',      label: 'Products to show', type: 'slider', min: 3, max: 20 },
      { key: 'autoplay',         label: 'Autoplay',          type: 'toggle' },
      { key: 'autoplayInterval', label: 'Autoplay speed (ms)', type: 'slider', min: 1000, max: 8000, step: 500,
        condition: { key: 'autoplay', value: true } },
      { key: 'showArrows',  label: 'Show arrows',  type: 'toggle' },
      { key: 'showDots',    label: 'Show dots',    type: 'toggle' },
      { key: 'imageAspectRatio', label: 'Image ratio', type: 'select',
        options: [
          { value: '1/1', label: 'Square'   },
          { value: '3/4', label: 'Portrait' },
          { value: '4/3', label: 'Landscape'},
        ] },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Filterable Product Grid ──────────────────────────────────────────
  // Shop page section: products on the right, filter sidebar on the left.
  // Loads live products from the backend, supports search/sort/grid-vs-list,
  // and uses the global cart drawer for add-to-cart + checkout.
  'filter-product-grid': {
    type:        'filter-product-grid',
    name:        'Filterable Product Grid',
    description: 'Shop view with filter sidebar, search, sort and add-to-cart.',
    icon:        'SlidersHorizontal',
    category:    'commerce',
    defaultSettings: {
      heading:        'Shop',
      collection:     '',         // optional collection slug to scope the query
      limit:          48,
      columns:        4,
      showFilters:    true,
      showSearch:     true,
      showSort:       true,
      showViewToggle: true,
      showAddToCart:  true,
      defaultView:    'grid',     // 'grid' | 'list'
      categories:     ['All Items', 'Outerwear', 'Knitwear', 'Trousers', 'Footwear', 'Accessories'],
      sizes:          ['XS', 'S', 'M', 'L', 'XL'],
      priceMin:       0,
      priceMax:       1000,
    },
    defaultLayout: {
      padding:    sectionPad(40),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'heading',        label: 'Heading',          type: 'text' },
      { key: 'collection',     label: 'Collection (optional)', type: 'text', placeholder: 'e.g. summer-2026' },
      { key: 'limit',          label: 'Products to load', type: 'slider', min: 8, max: 100, step: 4 },
      { key: 'columns',        label: 'Grid columns',     type: 'slider', min: 2, max: 5 },
      { key: 'defaultView',    label: 'Default view',     type: 'select',
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ] },
      { key: 'showFilters',    label: 'Show filter sidebar', type: 'toggle' },
      { key: 'showSearch',     label: 'Show search bar',     type: 'toggle' },
      { key: 'showSort',       label: 'Show sort dropdown',  type: 'toggle' },
      { key: 'showViewToggle', label: 'Show grid/list toggle', type: 'toggle' },
      { key: 'showAddToCart',  label: 'Show "Add to bag" on hover', type: 'toggle' },
      { key: 'priceMin',       label: 'Price filter min', type: 'number', min: 0, group: 'Filters' },
      { key: 'priceMax',       label: 'Price filter max', type: 'number', min: 0, group: 'Filters' },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Gallery ───────────────────────────────────────────────────────────
  gallery: {
    type:        'gallery',
    name:        'Gallery',
    description: 'Image grid, masonry, or carousel gallery.',
    icon:        'Images',
    category:    'media',
    defaultSettings: {
      heading:       '',
      layout:        'grid',
      columns:       3,
      gap:           8,
      imageRadius:   0,
      aspectRatio:   '1/1',
      lightbox:      true,
      showCaptions:  false,
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks: [
      { type: 'gallery-image', visible: true, settings: { url: '', alt: '', caption: '' } },
      { type: 'gallery-image', visible: true, settings: { url: '', alt: '', caption: '' } },
      { type: 'gallery-image', visible: true, settings: { url: '', alt: '', caption: '' } },
    ],
    settingsFields: [
      { key: 'heading',  label: 'Heading',  type: 'text' },
      { key: 'layout',   label: 'Layout',   type: 'select',
        options: [
          { value: 'grid',     label: 'Grid'    },
          { value: 'masonry',  label: 'Masonry' },
          { value: 'carousel', label: 'Carousel'},
        ] },
      { key: 'columns',     label: 'Columns', type: 'slider', min: 2, max: 5,
        condition: { key: 'layout', value: 'grid' } },
      { key: 'gap',         label: 'Gap (px)', type: 'slider', min: 0, max: 48 },
      { key: 'aspectRatio', label: 'Image ratio', type: 'select',
        options: [
          { value: '1/1',  label: 'Square'     },
          { value: '4/3',  label: 'Landscape'  },
          { value: '3/4',  label: 'Portrait'   },
          { value: 'auto', label: 'Auto'       },
        ] },
      { key: 'imageRadius',  label: 'Image border radius', type: 'slider', min: 0, max: 32 },
      { key: 'lightbox',     label: 'Enable lightbox',    type: 'toggle' },
      { key: 'showCaptions', label: 'Show captions',      type: 'toggle' },
      { key: 'blocks-manager', label: 'Images', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      'gallery-image': {
        type: 'gallery-image', name: 'Image', icon: 'Image',
        defaultSettings: { url: '', alt: '', caption: '' },
        fields: [
          { key: 'url',     label: 'Image',   type: 'image'   },
          { key: 'alt',     label: 'Alt text', type: 'text'   },
          { key: 'caption', label: 'Caption',  type: 'text'   },
        ],
      },
    },
    addableBlocks: ['gallery-image'],
  },

  // ── Testimonials ──────────────────────────────────────────────────────
  testimonials: {
    type:        'testimonials',
    name:        'Testimonials',
    description: 'Customer reviews displayed as carousel or grid.',
    icon:        'Quote',
    category:    'engagement',
    defaultSettings: {
      heading:          'What Our Customers Say',
      layout:           'carousel',
      columns:          3,
      autoplay:         true,
      autoplayInterval: 5000,
      showRating:       true,
      showAvatar:       true,
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...surfaceBg },
    },
    defaultBlocks: [
      { type: 'testimonial', visible: true, settings: {
        quote: '"Absolutely love my purchase! The quality exceeded my expectations."',
        author: 'Sarah M.', role: 'Verified Buyer', avatarUrl: '', rating: 5 } },
      { type: 'testimonial', visible: true, settings: {
        quote: '"Fast shipping and beautiful packaging. Will definitely order again."',
        author: 'James L.', role: 'Verified Buyer', avatarUrl: '', rating: 5 } },
      { type: 'testimonial', visible: true, settings: {
        quote: '"Outstanding customer service. They went above and beyond."',
        author: 'Emily R.', role: 'Verified Buyer', avatarUrl: '', rating: 5 } },
    ],
    settingsFields: [
      { key: 'heading', label: 'Section heading', type: 'text' },
      { key: 'layout', label: 'Layout', type: 'select',
        options: [
          { value: 'carousel', label: 'Carousel' },
          { value: 'grid',     label: 'Grid'     },
        ] },
      { key: 'columns', label: 'Columns', type: 'slider', min: 1, max: 4,
        condition: { key: 'layout', value: 'grid' } },
      { key: 'autoplay', label: 'Autoplay',       type: 'toggle',
        condition: { key: 'layout', value: 'carousel' } },
      { key: 'autoplayInterval', label: 'Speed (ms)', type: 'slider', min: 2000, max: 8000, step: 500,
        condition: { key: 'autoplay', value: true } },
      { key: 'showRating', label: 'Show star rating', type: 'toggle' },
      { key: 'showAvatar', label: 'Show avatars',     type: 'toggle' },
      { key: 'blocks-manager', label: 'Reviews', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      testimonial: {
        type: 'testimonial', name: 'Review', icon: 'MessageSquare',
        defaultSettings: { quote: '', author: '', role: '', avatarUrl: '', rating: 5 },
        fields: [
          { key: 'quote',     label: 'Quote',      type: 'textarea' },
          { key: 'author',    label: 'Author name', type: 'text'    },
          { key: 'role',      label: 'Role / label', type: 'text'   },
          { key: 'avatarUrl', label: 'Avatar image', type: 'image'  },
          { key: 'rating',    label: 'Rating (1-5)', type: 'slider', min: 1, max: 5, step: 1 },
        ],
      },
    },
    addableBlocks: ['testimonial'],
  },

  // ── Info / About ──────────────────────────────────────────────────────
  info: {
    type:        'info',
    name:        'Info / About',
    description: 'Image + text section for brand story, about, or feature callout.',
    icon:        'AlignLeft',
    category:    'content',
    defaultSettings: {
      layout:      'image-right',
      image:       '',
      imageRadius: 8,
      imageShadow: false,
      heading:     'Our Story',
      headingTypography: { ...TYPO, fontSize: 36, fontWeight: 700, color: '' },
      body:        '<p>Tell your brand story here. What makes you unique? What values drive your business? Share what your customers care about.</p>',
      showCta:     true,
      ctaButton:   { ...BTN, label: 'Learn More', url: '#' },
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'layout', label: 'Layout', type: 'select',
        options: [
          { value: 'image-right', label: 'Image right' },
          { value: 'image-left',  label: 'Image left'  },
          { value: 'image-top',   label: 'Image top'   },
        ] },
      { key: 'image',       label: 'Image',              type: 'image' },
      { key: 'imageRadius', label: 'Image border radius', type: 'slider', min: 0, max: 64 },
      { key: 'imageShadow', label: 'Image shadow',        type: 'toggle' },
      { key: 'heading',     label: 'Heading',             type: 'text' },
      { key: 'body',        label: 'Body',                type: 'richtext' },
      { key: 'showCta',     label: 'Show button',         type: 'toggle' },
      { key: 'ctaButton',   label: 'Button',              type: 'button-style',
        condition: { key: 'showCta', value: true } },
      { key: 'headingTypography', label: 'Heading style', type: 'typography', group: 'Typography' },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Features / Benefits ───────────────────────────────────────────────
  features: {
    type:        'features',
    name:        'Features / Benefits',
    description: 'Icon + text grid showcasing product features or brand benefits.',
    icon:        'Sparkles',
    category:    'content',
    defaultSettings: {
      heading:     'Why Choose Us',
      subheading:  '',
      columns:     3,
      iconColor:   '',
      iconSize:    40,
      iconStyle:   'outlined',
      cardStyle:   'plain',
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks: [
      { type: 'feature', visible: true, settings: {
        icon: 'Truck', heading: 'Free Shipping', description: 'On all orders over $50' } },
      { type: 'feature', visible: true, settings: {
        icon: 'ShieldCheck', heading: 'Secure Payment', description: 'SSL encrypted checkout' } },
      { type: 'feature', visible: true, settings: {
        icon: 'RotateCcw', heading: 'Easy Returns', description: '30-day hassle-free returns' } },
    ],
    settingsFields: [
      { key: 'heading',    label: 'Heading',    type: 'text' },
      { key: 'subheading', label: 'Subheading', type: 'text' },
      { key: 'columns',    label: 'Columns',    type: 'slider', min: 1, max: 4 },
      { key: 'iconColor',  label: 'Icon color', type: 'color' },
      { key: 'iconSize',   label: 'Icon size',  type: 'slider', min: 20, max: 80 },
      { key: 'cardStyle',  label: 'Card style', type: 'select',
        options: [
          { value: 'plain',    label: 'Plain'    },
          { value: 'bordered', label: 'Bordered' },
          { value: 'filled',   label: 'Filled'   },
          { value: 'shadow',   label: 'Shadow'   },
        ] },
      { key: 'blocks-manager', label: 'Features', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      feature: {
        type: 'feature', name: 'Feature', icon: 'Star',
        defaultSettings: { icon: 'Star', heading: 'Feature', description: '' },
        fields: [
          { key: 'icon',        label: 'Icon name (Lucide)', type: 'text', placeholder: 'Truck' },
          { key: 'heading',     label: 'Heading',            type: 'text'     },
          { key: 'description', label: 'Description',        type: 'textarea' },
        ],
      },
    },
    addableBlocks: ['feature'],
  },

  // ── Category Showcase ─────────────────────────────────────────────────
  categories: {
    type:        'categories',
    name:        'Category Showcase',
    description: 'Visual grid to highlight product categories.',
    icon:        'Grid2x2',
    category:    'commerce',
    defaultSettings: {
      heading:         'Shop by Category',
      columns:         3,
      imageAspectRatio: '1/1',
      overlayStyle:    'bottom',
      imageRadius:     4,
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks: [
      { type: 'category-card', visible: true, settings: { name: 'Accessories', imageUrl: '', linkUrl: '/products' } },
      { type: 'category-card', visible: true, settings: { name: 'Clothing',    imageUrl: '', linkUrl: '/products' } },
      { type: 'category-card', visible: true, settings: { name: 'Footwear',    imageUrl: '', linkUrl: '/products' } },
    ],
    settingsFields: [
      { key: 'heading', label: 'Heading',  type: 'text' },
      { key: 'columns', label: 'Columns',  type: 'slider', min: 2, max: 5 },
      { key: 'imageAspectRatio', label: 'Image ratio', type: 'select',
        options: [
          { value: '1/1', label: 'Square'    },
          { value: '3/4', label: 'Portrait'  },
          { value: '4/3', label: 'Landscape' },
        ] },
      { key: 'imageRadius', label: 'Border radius', type: 'slider', min: 0, max: 32 },
      { key: 'overlayStyle', label: 'Text overlay', type: 'select',
        options: [
          { value: 'none',   label: 'No overlay' },
          { value: 'bottom', label: 'Bottom fade' },
          { value: 'full',   label: 'Full overlay' },
          { value: 'hover',  label: 'On hover'    },
        ] },
      { key: 'blocks-manager', label: 'Categories', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      'category-card': {
        type: 'category-card', name: 'Category', icon: 'Tag',
        defaultSettings: { name: '', imageUrl: '', linkUrl: '' },
        fields: [
          { key: 'name',     label: 'Category name', type: 'text'  },
          { key: 'imageUrl', label: 'Image',         type: 'image' },
          { key: 'linkUrl',  label: 'Link URL',      type: 'url'   },
        ],
      },
    },
    addableBlocks: ['category-card'],
  },

  // ── Newsletter Signup ─────────────────────────────────────────────────
  newsletter: {
    type:        'newsletter',
    name:        'Newsletter Signup',
    description: 'Email capture form with heading and description.',
    icon:        'Mail',
    category:    'engagement',
    defaultSettings: {
      heading:        'Stay in the Loop',
      description:    'Subscribe for exclusive deals, new arrivals, and insider updates.',
      placeholder:    'Enter your email address',
      buttonText:     'Subscribe',
      disclaimer:     'No spam. Unsubscribe anytime.',
      layout:         'centered',
      inputRadius:    4,
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...surfaceBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'layout', label: 'Layout', type: 'select',
        options: [
          { value: 'centered', label: 'Centered' },
          { value: 'split',    label: 'Split'     },
          { value: 'inline',   label: 'Inline'    },
        ] },
      { key: 'heading',     label: 'Heading',      type: 'text'    },
      { key: 'description', label: 'Description',  type: 'textarea' },
      { key: 'placeholder', label: 'Input placeholder', type: 'text' },
      { key: 'buttonText',  label: 'Button text',  type: 'text'    },
      { key: 'button',      label: 'Button style', type: 'button-style' },
      { key: 'disclaimer',  label: 'Disclaimer',   type: 'text'    },
      { key: 'inputRadius', label: 'Input border radius', type: 'slider', min: 0, max: 32 },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── FAQ Accordion ─────────────────────────────────────────────────────
  faq: {
    type:        'faq',
    name:        'FAQ Accordion',
    description: 'Expandable questions and answers section.',
    icon:        'HelpCircle',
    category:    'content',
    defaultSettings: {
      heading:       'Frequently Asked Questions',
      subheading:    '',
      defaultOpen:   0,
      dividerColor:  '',
      questionTypography: { ...TYPO, fontSize: 16, fontWeight: 600 },
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks: [
      { type: 'faq-item', visible: true, settings: {
        question: 'What is your return policy?',
        answer: 'We offer hassle-free 30-day returns on all unused items in original packaging.' } },
      { type: 'faq-item', visible: true, settings: {
        question: 'How long does shipping take?',
        answer: 'Standard shipping takes 3-7 business days. Express options are available at checkout.' } },
      { type: 'faq-item', visible: true, settings: {
        question: 'Do you ship internationally?',
        answer: 'Yes! We ship to over 50 countries. International shipping rates apply.' } },
    ],
    settingsFields: [
      { key: 'heading',    label: 'Heading',    type: 'text' },
      { key: 'subheading', label: 'Subheading', type: 'text' },
      { key: 'questionTypography', label: 'Question style', type: 'typography', group: 'Typography' },
      { key: 'dividerColor', label: 'Divider color', type: 'color', group: 'Style' },
      { key: 'blocks-manager', label: 'Questions', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      'faq-item': {
        type: 'faq-item', name: 'FAQ Item', icon: 'Plus',
        defaultSettings: { question: '', answer: '' },
        fields: [
          { key: 'question', label: 'Question', type: 'text'     },
          { key: 'answer',   label: 'Answer',   type: 'richtext' },
        ],
      },
    },
    addableBlocks: ['faq-item'],
  },

  // ── Rich Text ─────────────────────────────────────────────────────────
  'rich-text': {
    type:        'rich-text',
    name:        'Rich Text',
    description: 'Freeform content block with heading and formatted text.',
    icon:        'FileText',
    category:    'content',
    defaultSettings: {
      heading:    '',
      content:    '<p>Add your content here. Use the editor to format text, add links, and more.</p>',
      headingTypography: { ...TYPO, fontSize: 32, fontWeight: 700 },
      contentTypography: { ...TYPO },
      maxWidth:   720,
    },
    defaultLayout: {
      padding:      sectionPad(),
      background:   { ...whiteBg },
      contentAlign: 'center',
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'heading',  label: 'Heading', type: 'text' },
      { key: 'content',  label: 'Content', type: 'richtext' },
      { key: 'maxWidth', label: 'Max width (px)', type: 'number', min: 320, max: 1200 },
      { key: 'headingTypography', label: 'Heading style', type: 'typography', group: 'Typography' },
      { key: 'contentTypography', label: 'Content style', type: 'typography', group: 'Typography' },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Video ─────────────────────────────────────────────────────────────
  video: {
    type:        'video',
    name:        'Video',
    description: 'Embed a YouTube, Vimeo, or direct video.',
    icon:        'Play',
    category:    'media',
    defaultSettings: {
      heading:    '',
      videoUrl:   '',
      autoplay:   false,
      muted:      true,
      loop:       false,
      controls:   true,
      aspectRatio: '16/9',
      posterUrl:  '',
    },
    defaultLayout: {
      padding:    sectionPad(),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'heading',     label: 'Heading',         type: 'text' },
      { key: 'videoUrl',    label: 'Video URL',       type: 'url',  placeholder: 'https://youtube.com/…' },
      { key: 'posterUrl',   label: 'Poster / thumbnail', type: 'image' },
      { key: 'aspectRatio', label: 'Aspect ratio',   type: 'select',
        options: [
          { value: '16/9', label: '16:9 (Widescreen)' },
          { value: '4/3',  label: '4:3'               },
          { value: '1/1',  label: 'Square'            },
          { value: '9/16', label: '9:16 (Vertical)'   },
        ] },
      { key: 'autoplay', label: 'Autoplay',  type: 'toggle' },
      { key: 'muted',    label: 'Muted',     type: 'toggle' },
      { key: 'loop',     label: 'Loop',      type: 'toggle' },
      { key: 'controls', label: 'Show controls', type: 'toggle' },
      ...LAYOUT_FIELDS,
    ],
  },

  // ── Spacer ────────────────────────────────────────────────────────────
  spacer: {
    type:        'spacer',
    name:        'Spacer',
    description: 'Add vertical whitespace between sections.',
    icon:        'ArrowUpDown',
    category:    'advanced',
    defaultSettings: { height: 80 },
    defaultLayout: {
      width: 'full',
      padding: SP,
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'height', label: 'Height (px)', type: 'slider', min: 8, max: 400 },
      { key: 'layout__background', label: 'Background', type: 'background', group: 'Style' },
      { key: 'customCSS', label: 'Custom CSS', type: 'custom-css', group: 'Advanced' },
    ],
  },

  // ── Divider ───────────────────────────────────────────────────────────
  divider: {
    type:        'divider',
    name:        'Divider',
    description: 'Horizontal line or decorative separator.',
    icon:        'Minus',
    category:    'advanced',
    defaultSettings: {
      style:     'solid',
      color:     '',
      thickness: 1,
      width:     100,
    },
    defaultLayout: {
      width: 'contained',
      padding: { top: 24, right: 0, bottom: 24, left: 0 },
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'style', label: 'Style', type: 'select',
        options: [
          { value: 'solid',  label: 'Solid'  },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
      { key: 'color',     label: 'Color',       type: 'color'  },
      { key: 'thickness', label: 'Thickness (px)', type: 'slider', min: 1, max: 8 },
      { key: 'width',     label: 'Width (%)',    type: 'slider', min: 10, max: 100 },
      { key: 'customCSS', label: 'Custom CSS',  type: 'custom-css', group: 'Advanced' },
    ],
  },

  // ── Footer ────────────────────────────────────────────────────────────
  footer: {
    type:        'footer',
    name:        'Footer',
    description: 'Site footer with logo, links, social icons, and copyright.',
    icon:        'PanelBottom',
    category:    'structure',
    defaultSettings: {
      logoUrl:      '',
      aboutText:    'Quality products with exceptional service.',
      showSocial:   true,
      socialLinks: {
        instagram: '', twitter: '', facebook: '', tiktok: '', youtube: '',
      },
      copyrightText: `© ${new Date().getFullYear()} My Store. All rights reserved.`,
      copyrightColor: '',
    },
    defaultLayout: {
      width: 'full',
      padding: { top: 64, right: 40, bottom: 40, left: 40 },
      background: { ...darkBg },
    },
    defaultBlocks: [
      { type: 'footer-column', visible: true, settings: {
        heading: 'Quick Links',
        links: [{ label: 'Home', url: '/' }, { label: 'Shop', url: '/products' }, { label: 'Cart', url: '/cart' }],
      } },
      { type: 'footer-column', visible: true, settings: {
        heading: 'Support',
        links: [{ label: 'FAQ', url: '#' }, { label: 'Returns', url: '#' }, { label: 'Contact', url: '#' }],
      } },
    ],
    settingsFields: [
      { key: 'logoUrl',       label: 'Logo',          type: 'image' },
      { key: 'aboutText',     label: 'About text',    type: 'textarea' },
      { key: 'showSocial',    label: 'Show social icons', type: 'toggle' },
      { key: 'socialLinks',   label: 'Social links',  type: 'select', group: 'Social',
        description: 'Edit individual social URLs below' },
      { key: 'socialLinks.instagram', label: 'Instagram URL', type: 'url', group: 'Social',
        condition: { key: 'showSocial', value: true } },
      { key: 'socialLinks.twitter',   label: 'Twitter URL',   type: 'url', group: 'Social',
        condition: { key: 'showSocial', value: true } },
      { key: 'socialLinks.facebook',  label: 'Facebook URL',  type: 'url', group: 'Social',
        condition: { key: 'showSocial', value: true } },
      { key: 'socialLinks.tiktok',    label: 'TikTok URL',    type: 'url', group: 'Social',
        condition: { key: 'showSocial', value: true } },
      { key: 'copyrightText',  label: 'Copyright text', type: 'text' },
      { key: 'blocks-manager', label: 'Link columns', type: 'blocks-manager' },
      ...LAYOUT_FIELDS,
    ],
    blockTypes: {
      'footer-column': {
        type: 'footer-column', name: 'Link column', icon: 'List',
        defaultSettings: { heading: '', links: [] },
        fields: [
          { key: 'heading', label: 'Column heading', type: 'text' },
        ],
      },
    },
    addableBlocks: ['footer-column'],
    locked: true,
  },

  // ── Custom / Blank ────────────────────────────────────────────────────
  custom: {
    type:        'custom',
    name:        'Custom Section',
    description: 'Blank section with full custom HTML/CSS/Tailwind support.',
    icon:        'Code',
    category:    'advanced',
    defaultSettings: {
      htmlContent: '',
    },
    defaultLayout: {
      padding:    sectionPad(40),
      background: { ...whiteBg },
    },
    defaultBlocks:  [],
    settingsFields: [
      { key: 'htmlContent', label: 'HTML', type: 'richtext', placeholder: 'Enter raw HTML…' },
      ...LAYOUT_FIELDS,
    ],
  },
};

export default REGISTRY;

export function getSectionDef(type: SectionType): SectionDef {
  return REGISTRY[type];
}

export function getAllSectionDefs(): SectionDef[] {
  return Object.values(REGISTRY);
}

// Sections grouped by category for the Section Library panel
export const SECTION_CATEGORIES = {
  structure:  ['announcement-bar', 'header', 'footer'],
  content:    ['hero', 'info', 'features', 'rich-text', 'faq'],
  commerce:   ['product-grid', 'product-carousel', 'filter-product-grid', 'categories'],
  media:      ['gallery', 'video'],
  engagement: ['testimonials', 'newsletter'],
  advanced:   ['spacer', 'divider', 'custom'],
} as const;

export const CATEGORY_LABELS: Record<string, string> = {
  structure:  'Structure',
  content:    'Content',
  commerce:   'Commerce',
  media:      'Media',
  engagement: 'Engagement',
  advanced:   'Advanced',
};
