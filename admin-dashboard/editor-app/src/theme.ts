/* =================================================================
   Upcart Store Editor — Theme mode

   The editor chrome supports three modes:
     • auto  — follow the operating system's light/dark preference
     • light — always light
     • dark  — always dark

   The mode is reflected as a `data-ed-theme` attribute on <html>, which
   selects the matching CSS variable set in index.css. An inline script in
   index.html applies the persisted mode before first paint to avoid a
   flash; this module keeps it in sync afterwards.
================================================================= */

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'upcart_editor_theme';

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'auto';
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-ed-theme', mode);
}

export function setThemeMode(mode: ThemeMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  applyThemeMode(mode);
}

// Cycle order used by the top-bar toggle: auto → light → dark → auto.
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
}
