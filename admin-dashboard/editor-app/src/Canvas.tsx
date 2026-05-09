import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor } from './store';
import { themeToCssVars } from './utils';
import type { Viewport } from './types';

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet:  '768px',
  mobile:  '390px',
};

export default function Canvas() {
  const schema       = useEditor(s => s.schema);
  const viewport     = useEditor(s => s.viewport);
  const selectSection = useEditor(s => s.selectSection);
  const iframeRef    = useRef<HTMLIFrameElement>(null);

  const auth = (() => {
    const workerUrl = sessionStorage.getItem('upcart_worker_url') ?? '';
    const storeUrl  = (() => {
      try { return JSON.parse(sessionStorage.getItem('upcart_tenant_ctx') || '{}').store_url ?? ''; } catch { return ''; }
    })();
    return { workerUrl, storeUrl };
  })();

  // The iframe src — point to the customer store. The storefront's
  // store-renderer.js receives `bst:schema` postMessages and re-renders.
  // TODO(ui): nicer empty state when storeUrl isn't set yet.
  const iframeSrc = auth.storeUrl
    ? `${auth.storeUrl.replace(/\/$/, '')}/index.html`
    : 'about:blank';

  const [hasError, setHasError] = useState(false);

  // ── postMessage to iframe ──────────────────────────────────────────────
  const post = useCallback((msg: unknown) => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    try { frame.contentWindow.postMessage(msg, '*'); } catch { /* cross-origin */ }
  }, []);

  const postSchema = useCallback(() => {
    post({ type: 'bst:schema', schema });
  }, [post, schema]);

  // Also push theme-only diffs as a lighter 'bst:preview' message, for
  // compatibility with the older theme.js renderer surface.
  const postTheme = useCallback(() => {
    const cssVars = themeToCssVars(schema.globalTheme);
    post({ type: 'bst:preview', settings: { _themeVars: cssVars } });
  }, [post, schema.globalTheme]);

  // ── ready handshake + iframe lifecycle ─────────────────────────────────
  // The storefront posts `bst:ready` once its renderer is wired up. Until
  // then, schema messages may be dropped because the listener isn't attached
  // yet. Track readiness and re-flush on transitions.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'bst:ready') {
        postSchema();
        postTheme();
      }
      if (d.type === 'bst:select-section') {
        selectSection(d.sectionId);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postSchema, postTheme, selectSection]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const onLoad = () => {
      // Old storefront builds (pre-ready-handshake) won't ever send bst:ready
      // — fire one push on load as a fallback, and also retry a moment later
      // in case the renderer attached its listener after the load event.
      postSchema();
      postTheme();
      setTimeout(() => { postSchema(); postTheme(); }, 50);
    };
    const onError = () => setHasError(true);
    frame.addEventListener('load',  onLoad);
    frame.addEventListener('error', onError);
    return () => {
      frame.removeEventListener('load',  onLoad);
      frame.removeEventListener('error', onError);
    };
  }, [postSchema, postTheme]);

  // Push on every schema change so the iframe stays in sync as the user
  // edits. If the iframe hasn't signalled ready yet, the message is still
  // posted (the renderer's listener may have attached without sending the
  // ready signal — older bundles do this), and we'll re-flush on ready too.
  useEffect(() => { postSchema(); }, [postSchema]);

  const width = VIEWPORT_WIDTHS[viewport];

  return (
    <div className="flex-1 flex flex-col items-center justify-start overflow-auto py-4 bg-ed-bg w-full h-full">
      <div
        className="relative transition-all duration-300 bg-white shadow-2xl"
        style={{ width, minWidth: viewport === 'desktop' ? 0 : width, maxWidth: '100%' }}
      >
        {hasError && (
          <div className="absolute top-2 left-2 right-2 z-10 bg-red-900/80 text-red-200 text-xs px-3 py-2 rounded">
            Couldn't load preview from {iframeSrc}. Edits will still save.
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Store Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="w-full border-0 block"
          style={{ minHeight: '100vh', height: '100%' }}
        />
      </div>
    </div>
  );
}
