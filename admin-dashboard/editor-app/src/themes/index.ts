/* =================================================================
   Upcart Store Editor — Built-in theme catalog

   The bundled themes the gallery shows out of the box. Each theme is a
   `*.theme.json` manifest whose `schema` is run through `normalizeSchema`
   at module load, so a sparsely-authored theme is backfilled from the
   registry and guaranteed editable. These same JSON files are mirrored to
   the provisioning service (seed) and served by the central theme-catalog
   API — see the plan / README for the sync note.
================================================================= */

import type { ThemeManifest, ThemeCatalogEntry } from '../types';
import { normalizeSchema } from '../normalize';

import editorialLuxe from './editorial-luxe.theme.json';
import mono from './mono.theme.json';
import boutique from './boutique.theme.json';

// The raw JSON is authored loosely; normalize the schema and surface a
// fully-typed ThemeManifest. Order here is the gallery display order.
const RAW: unknown[] = [editorialLuxe, mono, boutique];

export const BUILTIN_THEMES: ThemeManifest[] = RAW.map((r) => {
  const m = r as Record<string, unknown>;
  return {
    ...(m as unknown as ThemeCatalogEntry),
    schema: normalizeSchema(m.schema),
  };
});

export const DEFAULT_THEME_ID = 'editorial-luxe';

export function getTheme(id: string): ThemeManifest | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}

export function listThemes(): ThemeCatalogEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return BUILTIN_THEMES.map(({ schema, ...entry }) => entry);
}
