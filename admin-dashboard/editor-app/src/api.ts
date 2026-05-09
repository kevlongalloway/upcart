/* =================================================================
   Upcart Store Editor — API Helpers
================================================================= */

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
