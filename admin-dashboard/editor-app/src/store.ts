/* =================================================================
   Upcart Store Editor — Zustand Store
================================================================= */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  StoreSchema, Section, SectionType, Block, GlobalTheme, Viewport,
  SectionLayout,
} from './types';
import { DEFAULT_GLOBAL_THEME } from './types';
import { getSectionDef } from './registry';
import { loadSettings, saveSettings } from './api';

// ── Snapshot for undo/redo ─────────────────────────────────────────────────

interface Snapshot {
  schema:          StoreSchema;
  selectedPageId:  string;
  selectedSectionId: string | null;
  selectedBlockId:   string | null;
}

const MAX_HISTORY = 50;

// ── Editor State ───────────────────────────────────────────────────────────

export type LeftTab = 'pages' | 'sections' | 'library';

export interface EditorState {
  // ── schema ────────────────────────────────────────────────
  schema:            StoreSchema;
  // ── selection ─────────────────────────────────────────────
  selectedPageId:    string;
  selectedSectionId: string | null;
  selectedBlockId:   string | null;
  // ── UI ────────────────────────────────────────────────────
  viewport:          Viewport;
  leftTab:           LeftTab;
  rightTab:          'section' | 'block' | 'theme';
  // ── persistence ───────────────────────────────────────────
  isDirty:           boolean;
  isSaving:          boolean;
  isLoading:         boolean;
  loadError:         string | null;
  // ── undo/redo history ─────────────────────────────────────
  past:              Snapshot[];
  future:            Snapshot[];
}

export interface EditorActions {
  // ── init ──────────────────────────────────────────────────
  loadSchema:     () => Promise<void>;
  // ── page ──────────────────────────────────────────────────
  selectPage:     (pageId: string) => void;
  // ── section CRUD ──────────────────────────────────────────
  selectSection:  (id: string | null) => void;
  addSection:     (type: SectionType, afterId?: string | null) => void;
  removeSection:  (id: string) => void;
  duplicateSection: (id: string) => void;
  reorderSections: (ids: string[]) => void;
  toggleSectionVisible: (id: string) => void;
  updateSectionSettings: (id: string, patch: Record<string, unknown>) => void;
  updateSectionLayout:   (id: string, patch: Partial<SectionLayout>) => void;
  updateSectionCSS:      (id: string, css: string) => void;
  // ── block CRUD ────────────────────────────────────────────
  selectBlock:    (id: string | null) => void;
  addBlock:       (sectionId: string, blockType: string) => void;
  removeBlock:    (sectionId: string, blockId: string) => void;
  duplicateBlock: (sectionId: string, blockId: string) => void;
  reorderBlocks:  (sectionId: string, ids: string[]) => void;
  toggleBlockVisible: (sectionId: string, blockId: string) => void;
  updateBlockSettings: (sectionId: string, blockId: string, patch: Record<string, unknown>) => void;
  // ── global theme ──────────────────────────────────────────
  updateTheme:    (patch: Partial<GlobalTheme>) => void;
  // ── UI ────────────────────────────────────────────────────
  setViewport:    (v: Viewport) => void;
  setLeftTab:     (t: LeftTab) => void;
  setRightTab:    (t: 'section' | 'block' | 'theme') => void;
  // ── undo/redo ─────────────────────────────────────────────
  undo:           () => void;
  redo:           () => void;
  canUndo:        () => boolean;
  canRedo:        () => boolean;
  // ── persistence ───────────────────────────────────────────
  saveSchema:     () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Seeded section types — every brand-new tenant lands in the editor with a
// complete editorial homepage already populated, in this exact order. The
// section sequence mirrors customer-store/store-renderer.js's
// buildDefaultSchema() so the live storefront and the editor stay in lockstep:
// announcement, header, hero, features, filterable shop, info, testimonials,
// newsletter, footer.
const DEFAULT_SECTION_SEEDS: Array<{ id: string; type: SectionType }> = [
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

function buildSeededSection(id: string, type: SectionType): Section {
  const def = getSectionDef(type);
  return {
    id,
    type,
    label:         def.name,
    visible:       true,
    locked:        def.locked ?? false,
    layout:        JSON.parse(JSON.stringify(def.defaultLayout)) as Section['layout'],
    settings:      JSON.parse(JSON.stringify(def.defaultSettings)),
    // Seed blocks get stable IDs derived from the section ID + index so
    // re-seeding produces the same JSON byte-for-byte.
    blocks:        def.defaultBlocks.map((b, i) => ({ ...JSON.parse(JSON.stringify(b)), id: `${id}-block-${i}` })),
    customCSS:     '',
    customClasses: '',
  };
}

function makeDefaultSchema(): StoreSchema {
  return {
    version:     '2.0',
    globalTheme: DEFAULT_GLOBAL_THEME,
    pages: {
      index: {
        id:       'index',
        name:     'Home',
        icon:     'Home',
        slug:     'index.html',
        sections: DEFAULT_SECTION_SEEDS.map(s => buildSeededSection(s.id, s.type)),
      },
    },
  };
}

function snapshot(s: EditorState): Snapshot {
  return {
    schema:            JSON.parse(JSON.stringify(s.schema)),
    selectedPageId:    s.selectedPageId,
    selectedSectionId: s.selectedSectionId,
    selectedBlockId:   s.selectedBlockId,
  };
}

function pushHistory(s: EditorState): Pick<EditorState, 'past' | 'future'> {
  const past = [...s.past, snapshot(s)];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, future: [] };
}

function currentPage(s: EditorState) {
  return s.schema.pages[s.selectedPageId];
}

function mutateSections(
  s: EditorState,
  fn: (sections: Section[]) => Section[],
): StoreSchema {
  const schema = JSON.parse(JSON.stringify(s.schema)) as StoreSchema;
  schema.pages[s.selectedPageId].sections = fn(schema.pages[s.selectedPageId].sections);
  return schema;
}

function mutateSection(
  s: EditorState,
  id: string,
  fn: (sec: Section) => Section,
): StoreSchema {
  return mutateSections(s, secs => secs.map(sec => sec.id === id ? fn(sec) : sec));
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  schema:            makeDefaultSchema(),
  selectedPageId:    'index',
  selectedSectionId: null,
  selectedBlockId:   null,
  viewport:          'desktop',
  leftTab:           'sections',
  rightTab:          'theme',
  isDirty:           false,
  isSaving:          false,
  isLoading:         false,
  loadError:         null,
  past:              [],
  future:            [],

  // ── init ────────────────────────────────────────────────────────────────

  loadSchema: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const settings = await loadSettings();
      const raw = settings['page_sections'];
      // Empty / missing / malformed → fall through to the seeded default
      // schema (Header / Hero / Gallery / Footer). makeDefaultSchema() is
      // already in state from the initial create() call, so we just clear
      // the loading flag and leave it untouched.
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as StoreSchema;
          if (parsed && parsed.pages && typeof parsed.pages === 'object') {
            const firstPageId = Object.keys(parsed.pages)[0] ?? 'index';
            set({ schema: parsed, selectedPageId: firstPageId, isLoading: false, isDirty: false });
            return;
          }
        } catch {
          // fall through to defaults
        }
      }
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, loadError: String(err) });
    }
  },

  // ── page ────────────────────────────────────────────────────────────────

  selectPage: (pageId) => {
    set({ selectedPageId: pageId, selectedSectionId: null, selectedBlockId: null, rightTab: 'theme' });
  },

  // ── section ─────────────────────────────────────────────────────────────

  selectSection: (id) => {
    set({ selectedSectionId: id, selectedBlockId: null, rightTab: id ? 'section' : 'theme' });
  },

  addSection: (type, afterId = null) => {
    const s = get();
    const def = getSectionDef(type);
    if (!def) return;
    const newSection: Section = {
      id:            nanoid(8),
      type,
      label:         def.name,
      visible:       true,
      locked:        def.locked ?? false,
      layout:        { ...def.defaultLayout as ReturnType<typeof currentPage>['sections'][0]['layout'] } as Section['layout'],
      settings:      JSON.parse(JSON.stringify(def.defaultSettings)),
      blocks:        def.defaultBlocks.map(b => ({ ...b, id: nanoid(8) })),
      customCSS:     '',
      customClasses: '',
    };
    const hist = pushHistory(s);
    const schema = mutateSections(s, secs => {
      if (afterId === null) return [...secs, newSection];
      const idx = secs.findIndex(sec => sec.id === afterId);
      if (idx === -1) return [...secs, newSection];
      const next = [...secs];
      next.splice(idx + 1, 0, newSection);
      return next;
    });
    set({ ...hist, schema, selectedSectionId: newSection.id, rightTab: 'section', isDirty: true });
  },

  removeSection: (id) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSections(s, secs => secs.filter(sec => sec.id !== id));
    const sel = s.selectedSectionId === id ? null : s.selectedSectionId;
    set({ ...hist, schema, selectedSectionId: sel, isDirty: true });
  },

  duplicateSection: (id) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSections(s, secs => {
      const idx = secs.findIndex(sec => sec.id === id);
      if (idx === -1) return secs;
      const orig = secs[idx];
      const copy: Section = {
        ...JSON.parse(JSON.stringify(orig)),
        id:    nanoid(8),
        label: `${orig.label} (copy)`,
        locked: false,
        blocks: orig.blocks.map(b => ({ ...JSON.parse(JSON.stringify(b)), id: nanoid(8) })),
      };
      const next = [...secs];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    set({ ...hist, schema, isDirty: true });
  },

  reorderSections: (ids) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSections(s, secs => {
      const map = new Map(secs.map(sec => [sec.id, sec]));
      return ids.map(id => map.get(id)!).filter(Boolean);
    });
    set({ ...hist, schema, isDirty: true });
  },

  toggleSectionVisible: (id) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, id, sec => ({ ...sec, visible: !sec.visible }));
    set({ ...hist, schema, isDirty: true });
  },

  updateSectionSettings: (id, patch) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, id, sec => ({
      ...sec,
      settings: { ...sec.settings, ...patch },
    }));
    set({ ...hist, schema, isDirty: true });
  },

  updateSectionLayout: (id, patch) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, id, sec => ({
      ...sec,
      layout: { ...sec.layout, ...patch },
    }));
    set({ ...hist, schema, isDirty: true });
  },

  updateSectionCSS: (id, css) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, id, sec => ({ ...sec, customCSS: css }));
    set({ ...hist, schema, isDirty: true });
  },

  // ── blocks ──────────────────────────────────────────────────────────────

  selectBlock: (id) => {
    set({ selectedBlockId: id, rightTab: id ? 'block' : 'section' });
  },

  addBlock: (sectionId, blockType) => {
    const s = get();
    const def = getSectionDef(currentPage(s).sections.find(sec => sec.id === sectionId)?.type as SectionType);
    if (!def?.blockTypes) return;
    const blockDef = def.blockTypes[blockType];
    if (!blockDef) return;
    const newBlock: Block = {
      id:       nanoid(8),
      type:     blockType,
      visible:  true,
      settings: JSON.parse(JSON.stringify(blockDef.defaultSettings)),
    };
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => ({
      ...sec,
      blocks: [...sec.blocks, newBlock],
    }));
    set({ ...hist, schema, selectedBlockId: newBlock.id, rightTab: 'block', isDirty: true });
  },

  removeBlock: (sectionId, blockId) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => ({
      ...sec,
      blocks: sec.blocks.filter(b => b.id !== blockId),
    }));
    const sel = s.selectedBlockId === blockId ? null : s.selectedBlockId;
    set({ ...hist, schema, selectedBlockId: sel, isDirty: true });
  },

  duplicateBlock: (sectionId, blockId) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => {
      const idx = sec.blocks.findIndex(b => b.id === blockId);
      if (idx === -1) return sec;
      const copy = { ...JSON.parse(JSON.stringify(sec.blocks[idx])), id: nanoid(8) };
      const next = [...sec.blocks];
      next.splice(idx + 1, 0, copy);
      return { ...sec, blocks: next };
    });
    set({ ...hist, schema, isDirty: true });
  },

  reorderBlocks: (sectionId, ids) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => {
      const map = new Map(sec.blocks.map(b => [b.id, b]));
      return { ...sec, blocks: ids.map(id => map.get(id)!).filter(Boolean) };
    });
    set({ ...hist, schema, isDirty: true });
  },

  toggleBlockVisible: (sectionId, blockId) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b => b.id === blockId ? { ...b, visible: !b.visible } : b),
    }));
    set({ ...hist, schema, isDirty: true });
  },

  updateBlockSettings: (sectionId, blockId, patch) => {
    const s = get();
    const hist = pushHistory(s);
    const schema = mutateSection(s, sectionId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blockId ? { ...b, settings: { ...b.settings, ...patch } } : b,
      ),
    }));
    set({ ...hist, schema, isDirty: true });
  },

  // ── theme ────────────────────────────────────────────────────────────────

  updateTheme: (patch) => {
    const s = get();
    const hist = pushHistory(s);
    const schema: StoreSchema = {
      ...JSON.parse(JSON.stringify(s.schema)),
      globalTheme: { ...s.schema.globalTheme, ...patch },
    };
    set({ ...hist, schema, isDirty: true });
  },

  // ── UI ──────────────────────────────────────────────────────────────────

  setViewport:  (v) => set({ viewport: v }),
  setLeftTab:   (t) => set({ leftTab: t }),
  setRightTab:  (t) => set({ rightTab: t }),

  // ── undo/redo ────────────────────────────────────────────────────────────

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      past:              s.past.slice(0, -1),
      future:            [snapshot(s), ...s.future].slice(0, MAX_HISTORY),
      schema:            prev.schema,
      selectedPageId:    prev.selectedPageId,
      selectedSectionId: prev.selectedSectionId,
      selectedBlockId:   prev.selectedBlockId,
      isDirty:           true,
    });
  },

  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      past:              [...s.past, snapshot(s)].slice(-MAX_HISTORY),
      future:            s.future.slice(1),
      schema:            next.schema,
      selectedPageId:    next.selectedPageId,
      selectedSectionId: next.selectedSectionId,
      selectedBlockId:   next.selectedBlockId,
      isDirty:           true,
    });
  },

  // ── persistence ─────────────────────────────────────────────────────────

  saveSchema: async () => {
    const s = get();
    if (s.isSaving) return;
    set({ isSaving: true });
    try {
      await saveSettings({ page_sections: JSON.stringify(s.schema) });
      set({ isSaving: false, isDirty: false });
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
  },
}));
