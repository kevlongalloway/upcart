// Theme catalog for the provisioning service.
//
// This is a committed MIRROR of the editor's built-in themes
// (admin-dashboard/editor-app/src/themes/*.theme.json). The editor is the
// authoring source; these copies let the provisioning Worker seed a new
// tenant's `page_sections` with the signup-chosen theme and serve the central
// theme-catalog API (routes/themes.ts) without a cross-app TS import.
//
// Keep the two directories in sync — see the README sync note. The themes are
// authored sparsely; the storefront renderer fills visible defaults for any
// missing field, and opening the editor (which normalizes against the section
// registry) + Save upgrades the stub to the full schema.

import editorialLuxe from "./themes/editorial-luxe.theme.json";
import mono from "./themes/mono.theme.json";
import boutique from "./themes/boutique.theme.json";

export interface ThemeManifest {
  id: string;
  name: string;
  description: string;
  themeVersion: string;
  engineVersion: string;
  author: string;
  price: number;
  tags: string[];
  thumbnail: string;
  preview: string;
  builtIn: boolean;
  schema: unknown;
}

export type ThemeCatalogEntry = Omit<ThemeManifest, "schema">;

export const DEFAULT_THEME_ID = "editorial-luxe";

const CATALOG: ThemeManifest[] = [
  editorialLuxe as unknown as ThemeManifest,
  mono as unknown as ThemeManifest,
  boutique as unknown as ThemeManifest,
];

// Map the legacy signup/preset theme names onto catalog ids. Old wizards send
// "base" / "mono" / "boutique" etc.; everything unknown falls back to default.
const LEGACY_THEME_MAP: Record<string, string> = {
  base: "editorial-luxe",
  mono: "mono",
  boutique: "boutique",
  // retired presets collapse onto the closest catalog theme
  minimal: "editorial-luxe",
  studio: "editorial-luxe",
  bold: "mono",
};

export function resolveThemeId(input: string | undefined | null): string {
  if (!input) return DEFAULT_THEME_ID;
  if (CATALOG.some((t) => t.id === input)) return input;
  return LEGACY_THEME_MAP[input] ?? DEFAULT_THEME_ID;
}

export function getThemeManifest(id: string): ThemeManifest | undefined {
  return CATALOG.find((t) => t.id === id);
}

export function getThemeSchema(id: string): unknown {
  const t = getThemeManifest(resolveThemeId(id));
  return (t ?? CATALOG[0]!).schema;
}

export function listThemeCatalog(): ThemeCatalogEntry[] {
  return CATALOG.map(({ schema: _schema, ...entry }) => entry);
}

// Back-compat: the default tenant seed (editorial-luxe full schema).
export const DEFAULT_STORE_SCHEMA = getThemeSchema(DEFAULT_THEME_ID);
