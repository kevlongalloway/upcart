/* =================================================================
   Upcart Store Editor — Schema normalization & theme validation

   The safety layer that lets the editor load ANY StoreSchema — a seeded
   tenant default, an old/sparse saved schema, or a freshly-applied theme
   (including future purchased ones) — and be sure every section is
   registry-conformant so all of its fields render editable.

   `normalizeSchema` reuses the section REGISTRY exactly the way the store's
   seeding does: it backfills missing settings from `def.defaultSettings`,
   fills layout over `DEFAULT_SECTION_LAYOUT` + `def.defaultLayout`, repairs
   ids, and drops section/block types the registry doesn't know about.
================================================================= */

import { nanoid } from 'nanoid';
import type {
  StoreSchema, Section, Block, SectionType, Page, GlobalTheme, SectionLayout,
} from './types';
import { DEFAULT_GLOBAL_THEME, DEFAULT_SECTION_LAYOUT } from './types';
import REGISTRY, { getSectionDef } from './registry';

// ── small helpers ───────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Shallow-merge a partial over a base for the three globalTheme sub-objects.
function mergeSub<T extends object>(base: T, over: unknown): T {
  return isObj(over) ? { ...base, ...(over as object) } as T : base;
}

// ── globalTheme ─────────────────────────────────────────────────────────────

export function normalizeGlobalTheme(raw: unknown): GlobalTheme {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_GLOBAL_THEME;
  return {
    preset:     (typeof r.preset === 'string' ? r.preset : d.preset) as GlobalTheme['preset'],
    colors:     mergeSub(d.colors, r.colors),
    typography: mergeSub(d.typography, r.typography),
    spacing:    mergeSub(d.spacing, r.spacing),
    customCSS:  typeof r.customCSS === 'string' ? r.customCSS : d.customCSS,
  };
}

// ── sections / blocks ───────────────────────────────────────────────────────

// Build a fully-formed section from the registry. Used both for fresh seeds
// (no `raw`) and to repair/backfill an existing section (with `raw`).
export function buildSection(type: SectionType, id?: string, raw?: Partial<Section>): Section {
  const def = getSectionDef(type);
  const fullLayout: SectionLayout = {
    ...DEFAULT_SECTION_LAYOUT,
    ...clone(def.defaultLayout),
    ...(isObj(raw?.layout) ? (raw!.layout as Partial<SectionLayout>) : {}),
  };
  // Registry defaults sit UNDER the theme/merchant settings so authored
  // content (a hero headline, a header storeName) always wins, while every
  // other registry field is still present for the panel to render.
  const settings = {
    ...clone(def.defaultSettings),
    ...(isObj(raw?.settings) ? raw!.settings : {}),
  };

  const rawBlocks = Array.isArray(raw?.blocks) ? raw!.blocks : undefined;
  const baseId = id ?? (typeof raw?.id === 'string' && raw.id ? raw.id : nanoid(8));
  // Seed blocks get stable ids derived from the section id + index so
  // re-seeding is byte-for-byte stable. Key order matches normalizeBlocks().
  const blocks: Block[] = rawBlocks
    ? normalizeBlocks(type, rawBlocks)
    : def.defaultBlocks.map((b, i) => ({
        id:       `${baseId}-block-${i}`,
        type:     b.type,
        visible:  b.visible !== false,
        settings: clone(b.settings),
      }));

  return {
    id:            baseId,
    type,
    label:         typeof raw?.label === 'string' && raw.label ? raw.label : def.name,
    visible:       raw?.visible !== false,
    locked:        typeof raw?.locked === 'boolean' ? raw.locked : (def.locked ?? false),
    layout:        fullLayout,
    settings,
    blocks,
    customCSS:     typeof raw?.customCSS === 'string' ? raw.customCSS : '',
    customClasses: typeof raw?.customClasses === 'string' ? raw.customClasses : '',
  };
}

function normalizeBlocks(sectionType: SectionType, rawBlocks: unknown[]): Block[] {
  const def = getSectionDef(sectionType);
  const blockTypes = def.blockTypes ?? {};
  const out: Block[] = [];
  for (const rb of rawBlocks) {
    if (!isObj(rb)) continue;
    const bType = typeof rb.type === 'string' ? rb.type : '';
    const bDef = blockTypes[bType];
    if (!bDef) continue; // drop unknown block types
    out.push({
      id:       typeof rb.id === 'string' && rb.id ? rb.id : nanoid(8),
      type:     bType,
      visible:  rb.visible !== false,
      settings: { ...clone(bDef.defaultSettings), ...(isObj(rb.settings) ? rb.settings : {}) },
    });
  }
  return out;
}

function normalizeSection(raw: unknown): Section | null {
  if (!isObj(raw)) return null;
  const type = raw.type as SectionType;
  if (typeof type !== 'string' || !(type in REGISTRY)) return null; // drop unknown types
  return buildSection(type, undefined, raw as Partial<Section>);
}

function normalizePage(id: string, raw: unknown): Page {
  const r = isObj(raw) ? raw : {};
  const rawSections = Array.isArray(r.sections) ? r.sections : [];
  const seenIds = new Set<string>();
  const sections: Section[] = [];
  for (const rs of rawSections) {
    const sec = normalizeSection(rs);
    if (!sec) continue;
    // de-dupe ids so React keys / selection stay unambiguous
    if (seenIds.has(sec.id)) sec.id = nanoid(8);
    seenIds.add(sec.id);
    sections.push(sec);
  }
  return {
    id:       typeof r.id === 'string' && r.id ? r.id : id,
    name:     typeof r.name === 'string' && r.name ? r.name : 'Home',
    icon:     typeof r.icon === 'string' && r.icon ? r.icon : 'Home',
    slug:     typeof r.slug === 'string' && r.slug ? r.slug : 'index.html',
    sections,
  };
}

// ── root ────────────────────────────────────────────────────────────────────

export function normalizeSchema(raw: unknown): StoreSchema {
  const r = isObj(raw) ? raw : {};
  const pagesRaw = isObj(r.pages) ? r.pages : {};
  let pages: Record<string, Page> = {};
  for (const [pid, praw] of Object.entries(pagesRaw)) {
    pages[pid] = normalizePage(pid, praw);
  }
  // Guarantee at least one page so the editor/renderer never index `undefined`.
  if (Object.keys(pages).length === 0) {
    pages = { index: { id: 'index', name: 'Home', icon: 'Home', slug: 'index.html', sections: [] } };
  }
  return {
    version:     typeof r.version === 'string' && r.version ? r.version : '2.0',
    globalTheme: normalizeGlobalTheme(r.globalTheme),
    pages,
  };
}

// ── theme validation (for catalog / import paths) ───────────────────────────

export function validateTheme(m: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(m)) return { ok: false, errors: ['theme is not an object'] };
  for (const key of ['id', 'name', 'themeVersion', 'engineVersion'] as const) {
    if (typeof m[key] !== 'string' || !m[key]) errors.push(`missing "${key}"`);
  }
  if (typeof m.price !== 'number') errors.push('missing numeric "price"');
  if (!isObj(m.schema)) {
    errors.push('missing "schema"');
  } else {
    const pages = (m.schema as Record<string, unknown>).pages;
    if (!isObj(pages) || Object.keys(pages).length === 0) errors.push('schema has no pages');
  }
  return { ok: errors.length === 0, errors };
}

// ── default seed schema (the editorial-luxe homepage) ───────────────────────
// Every brand-new tenant lands in the editor with this complete homepage, in
// this exact order — mirrored by customer-store/store-renderer.js and the
// provisioning seed so editor and storefront stay in lockstep.

export const DEFAULT_SECTION_SEEDS: Array<{ id: string; type: SectionType }> = [
  { id: 'seed-announce',     type: 'announcement-bar'    },
  { id: 'seed-header',       type: 'header'              },
  { id: 'seed-hero',         type: 'hero'                },
  { id: 'seed-features',     type: 'features'            },
  { id: 'seed-shop',         type: 'filter-product-grid' },
  { id: 'seed-info',         type: 'info'                },
  { id: 'seed-testimonials', type: 'testimonials'        },
  { id: 'seed-newsletter',   type: 'newsletter'          },
  { id: 'seed-footer',       type: 'footer'              },
];

export function makeDefaultSchema(): StoreSchema {
  return {
    version:     '2.0',
    globalTheme: clone(DEFAULT_GLOBAL_THEME),
    pages: {
      index: {
        id:       'index',
        name:     'Home',
        icon:     'Home',
        slug:     'index.html',
        sections: DEFAULT_SECTION_SEEDS.map(s => buildSection(s.type, s.id)),
      },
    },
  };
}
