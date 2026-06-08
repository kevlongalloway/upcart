/* =================================================================
   Upcart Store Editor — API Helpers
================================================================= */

import type { ThemeManifest, ThemeCatalogEntry } from './types';
import { BUILTIN_THEMES, getTheme as getBundledTheme, listThemes as listBundledThemes } from './themes';

const AUTH_KEYS = {
  token:  'upcart_admin_token',
  worker: 'upcart_worker_url',
  ctx:    'upcart_tenant_ctx',
} as const;

export interface AuthContext {
  token:     string;
  workerUrl: string;
  storeUrl:  string;
  storeName: string;
}

export function getAuth(): AuthContext | null {
  const token     = sessionStorage.getItem(AUTH_KEYS.token);
  const workerUrl = sessionStorage.getItem(AUTH_KEYS.worker);
  if (!token || !workerUrl) return null;
  let ctx: Record<string, string> = {};
  try { ctx = JSON.parse(sessionStorage.getItem(AUTH_KEYS.ctx) || '{}'); } catch { /* */ }
  return {
    token,
    workerUrl: workerUrl.replace(/\/$/, ''),
    storeUrl:  (ctx.store_url  || '').replace(/\/$/, ''),
    storeName: ctx.store_name  || 'My Store',
  };
}

function formatApiError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      try { return JSON.stringify(obj.error); } catch { /* fallthrough */ }
    }
    if (obj.message && typeof obj.message === 'string') return obj.message;
    try { return JSON.stringify(obj); } catch { /* fallthrough */ }
  }
  return `HTTP ${status}`;
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const auth = getAuth();
  if (!auth) throw new Error('Not authenticated');
  const res = await fetch(`${auth.workerUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${auth.token}`,
      ...(opts.headers ?? {}),
    },
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON response */ }
  const ok = (body as { ok?: boolean } | null)?.ok === true;
  if (!res.ok || !ok) throw new Error(formatApiError(body, res.status));
  return (body as { data: T }).data;
}

export async function loadSettings(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>('/admin/settings');
}

export async function saveSettings(payload: Record<string, string>): Promise<void> {
  await apiFetch('/admin/settings', {
    method: 'PUT',
    body:   JSON.stringify(payload),
  });
}

// ── Theme catalog ───────────────────────────────────────────────────────────
// Built-in themes are bundled (so the gallery works offline). When a central
// catalog URL is configured (VITE_THEME_CATALOG_URL → the provisioning
// service's `/themes`), we merge remote/purchasable themes on top. This is the
// seam a future buy-flow plugs into; built-ins always remain available.

function catalogBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_THEME_CATALOG_URL ?? '').replace(/\/$/, '');
}

export async function listThemes(): Promise<ThemeCatalogEntry[]> {
  const base = catalogBase();
  if (!base) return listBundledThemes();
  try {
    const res  = await fetch(`${base}/themes`);
    const body = await res.json() as { ok: boolean; data?: ThemeCatalogEntry[] };
    if (!res.ok || !body.ok || !Array.isArray(body.data)) return listBundledThemes();
    // De-dupe by id, bundled first so built-ins win on conflict.
    const seen = new Set(BUILTIN_THEMES.map(t => t.id));
    return [...listBundledThemes(), ...body.data.filter(t => !seen.has(t.id))];
  } catch {
    return listBundledThemes();
  }
}

export async function getTheme(id: string): Promise<ThemeManifest | undefined> {
  const bundled = getBundledTheme(id);
  if (bundled) return bundled;
  const base = catalogBase();
  if (!base) return undefined;
  try {
    const res  = await fetch(`${base}/themes/${encodeURIComponent(id)}`);
    const body = await res.json() as { ok: boolean; data?: ThemeManifest };
    if (!res.ok || !body.ok || !body.data) return undefined;
    return body.data;
  } catch {
    return undefined;
  }
}

export async function uploadImage(file: File): Promise<{ url: string }> {
  const auth = getAuth();
  if (!auth) throw new Error('Not authenticated');
  const fd = new FormData();
  fd.append('file', file);
  const res  = await fetch(`${auth.workerUrl}/admin/images`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${auth.token}` },
    body:    fd,
  });
  const body = await res.json() as { ok: boolean; data?: { url: string }; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'Upload failed');
  return body.data!;
}
