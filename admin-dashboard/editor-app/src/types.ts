/* =================================================================
   Upcart Store Editor — Schema Types
   Every piece of the schema that drives both the editor UI and the
   storefront renderer lives here.
================================================================= */

// ── Primitives ─────────────────────────────────────────────────────────────

export type HexColor   = string;      // "#1a1a1a"
export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type TextAlign  = 'left' | 'center' | 'right' | 'justify';
export type Viewport   = 'desktop' | 'tablet' | 'mobile';

// ── Spacing ────────────────────────────────────────────────────────────────

export interface Spacing {
  top:    number;
  right:  number;
  bottom: number;
  left:   number;
}

export const DEFAULT_SPACING: Spacing = { top: 0, right: 0, bottom: 0, left: 0 };
export const SECTION_PADDING: Spacing = { top: 80, right: 24, bottom: 80, left: 24 };

// ── Background ─────────────────────────────────────────────────────────────

export type BackgroundType = 'color' | 'gradient' | 'image' | 'video';
export type GradientType   = 'linear' | 'radial';
export type BgSize         = 'cover' | 'contain' | 'auto';

export interface Background {
  type:              BackgroundType;
  color:             HexColor;
  gradientFrom:      HexColor;
  gradientTo:        HexColor;
  gradientAngle:     number;       // deg
  gradientType:      GradientType;
  imageUrl:          string;
  videoUrl:          string;
  overlayColor:      HexColor;
  overlayOpacity:    number;       // 0–1
  parallax:          boolean;
  backgroundSize:    BgSize;
  backgroundPosition: string;     // "center center"
}

export const DEFAULT_BACKGROUND: Background = {
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

// ── Typography ─────────────────────────────────────────────────────────────

export interface Typography {
  fontFamily:     string;
  fontSize:       number;       // px
  fontWeight:     FontWeight;
  lineHeight:     number;       // unitless
  letterSpacing:  number;       // em
  textAlign:      TextAlign;
  textTransform:  'none' | 'uppercase' | 'lowercase' | 'capitalize';
  color:          HexColor;
  italic:         boolean;
  underline:      boolean;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily:    'inherit',
  fontSize:      16,
  fontWeight:    400,
  lineHeight:    1.6,
  letterSpacing: 0,
  textAlign:     'left',
  textTransform: 'none',
  color:         '',
  italic:        false,
  underline:     false,
};

// ── Button Style ───────────────────────────────────────────────────────────

export type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'link';
export type ButtonSize    = 'sm' | 'md' | 'lg';
export type ShadowSize    = 'none' | 'sm' | 'md' | 'lg';

export interface ButtonStyle {
  label:                string;
  url:                  string;
  openInNewTab:         boolean;
  variant:              ButtonVariant;
  size:                 ButtonSize;
  backgroundColor:      HexColor;
  textColor:            HexColor;
  borderColor:          HexColor;
  borderRadius:         number;
  borderWidth:          number;
  paddingX:             number;
  paddingY:             number;
  fontSize:             number;
  fontWeight:           FontWeight;
  shadow:               ShadowSize;
  hoverBackgroundColor: HexColor;
  hoverTextColor:       HexColor;
  fullWidth:            boolean;
}

export const DEFAULT_BUTTON: ButtonStyle = {
  label:                'Button',
  url:                  '#',
  openInNewTab:         false,
  variant:              'solid',
  size:                 'md',
  backgroundColor:      '#111111',
  textColor:            '#ffffff',
  borderColor:          '#111111',
  borderRadius:         4,
  borderWidth:          2,
  paddingX:             24,
  paddingY:             12,
  fontSize:             14,
  fontWeight:           600,
  shadow:               'none',
  hoverBackgroundColor: '#333333',
  hoverTextColor:       '#ffffff',
  fullWidth:            false,
};

// ── Global Theme ───────────────────────────────────────────────────────────

export interface ThemeColors {
  primary:      HexColor;
  primaryText:  HexColor;
  secondary:    HexColor;
  accent:       HexColor;
  background:   HexColor;
  surface:      HexColor;
  text:         HexColor;
  textMuted:    HexColor;
  border:       HexColor;
}

export interface ThemeTypography {
  headingFont:    string;
  bodyFont:       string;
  baseFontSize:   number;
  headingWeight:  FontWeight;
  bodyWeight:     FontWeight;
  lineHeight:     number;
  letterSpacing:  number;
}

export interface ThemeSpacing {
  containerMaxWidth:        number;
  sectionVerticalPadding:   number;
  borderRadius:             number;
  cardBorderRadius:         number;
  elementGap:               number;
}

export type ThemePreset = 'base' | 'mono' | 'minimal' | 'boutique' | 'bold' | 'studio' | 'custom';

export interface GlobalTheme {
  preset:     ThemePreset;
  colors:     ThemeColors;
  typography: ThemeTypography;
  spacing:    ThemeSpacing;
  customCSS:  string;
}

export const DEFAULT_GLOBAL_THEME: GlobalTheme = {
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

// ── Section Layout ─────────────────────────────────────────────────────────

export type SectionWidth   = 'full' | 'wide' | 'contained' | 'narrow';
export type ContentAlign   = 'left' | 'center' | 'right';

export interface SectionLayout {
  width:          SectionWidth;
  padding:        Spacing;
  margin:         Spacing;
  background:     Background;
  minHeight:      number;
  contentAlign:   ContentAlign;
}

export const DEFAULT_SECTION_LAYOUT: SectionLayout = {
  width:        'contained',
  padding:      SECTION_PADDING,
  margin:       DEFAULT_SPACING,
  background:   DEFAULT_BACKGROUND,
  minHeight:    0,
  contentAlign: 'left',
};

// ── Block (sub-elements inside a section) ─────────────────────────────────

export interface Block {
  id:       string;
  type:     string;
  visible:  boolean;
  settings: Record<string, unknown>;
}

// ── Section ────────────────────────────────────────────────────────────────

export type SectionType =
  | 'announcement-bar'
  | 'header'
  | 'hero'
  | 'product-grid'
  | 'product-carousel'
  | 'filter-product-grid'
  | 'gallery'
  | 'testimonials'
  | 'info'
  | 'features'
  | 'categories'
  | 'newsletter'
  | 'faq'
  | 'rich-text'
  | 'video'
  | 'spacer'
  | 'divider'
  | 'footer'
  | 'custom';

export interface Section {
  id:            string;
  type:          SectionType;
  label:         string;
  visible:       boolean;
  locked:        boolean;    // prevents removal
  layout:        SectionLayout;
  settings:      Record<string, unknown>;
  blocks:        Block[];
  customCSS:     string;
  customClasses: string;
}

// ── Page ───────────────────────────────────────────────────────────────────

export interface Page {
  id:       string;
  name:     string;
  icon:     string;    // lucide icon name
  slug:     string;    // filename: "index.html"
  sections: Section[];
}

// ── Store Schema (root) ────────────────────────────────────────────────────

export interface StoreSchema {
  version:     string;   // "2.0"
  globalTheme: GlobalTheme;
  pages:       Record<string, Page>;
}

// ── Editor Field System ────────────────────────────────────────────────────
// The registry defines field schemas; the editor renders them dynamically.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'color'
  | 'font'
  | 'number'
  | 'slider'
  | 'select'
  | 'toggle'
  | 'image'
  | 'url'
  | 'spacing'
  | 'background'
  | 'typography'
  | 'button-style'
  | 'custom-css'
  | 'blocks-manager'; // renders the block list for this section

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldCondition {
  key:   string;
  value: unknown;
}

export interface FieldDef {
  key:          string;
  label:        string;
  type:         FieldType;
  defaultValue?: unknown;
  description?: string;
  placeholder?: string;
  options?:     SelectOption[];
  min?:         number;
  max?:         number;
  step?:        number;
  group?:       string;    // group heading in the panel
  condition?:   FieldCondition;
}

// ── Block Type ─────────────────────────────────────────────────────────────

export interface BlockTypeDef {
  type:            string;
  name:            string;
  icon:            string;   // lucide icon name
  defaultSettings: Record<string, unknown>;
  fields:          FieldDef[];
}

// ── Section Definition (registry entry) ───────────────────────────────────

export type SectionCategory = 'structure' | 'content' | 'commerce' | 'media' | 'engagement' | 'advanced';

export interface SectionDef {
  type:            SectionType;
  name:            string;
  description:     string;
  icon:            string;   // lucide icon name
  category:        SectionCategory;
  defaultSettings: Record<string, unknown>;
  defaultLayout:   Partial<SectionLayout>;
  defaultBlocks:   Array<Omit<Block, 'id'>>;
  settingsFields:  FieldDef[];
  blockTypes?:     Record<string, BlockTypeDef>;
  addableBlocks?:  string[];   // block type keys that can be added
  maxBlocks?:      number;
  locked?:         boolean;
}
