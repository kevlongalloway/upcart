import React, { useEffect, useRef, useCallback } from 'react';
import { useEditor } from './store';
import { themeToCssVars } from './utils';
import type { Viewport } from './types';

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: '100%',
  tablet:  '768px',
  mobile:  '390px',
};

const PREVIEW_ORIGIN = window.location.origin;

export default function Canvas() {
  const schema       = useEditor(s => s.schema);
  const viewport     = useEditor(s => s.viewport);
  const selectSection = useEditor(s => s.selectSection);
  const iframeRef    = useRef<HTMLIFrameElement>(null);
  const auth         = (() => {
    const workerUrl = sessionStorage.getItem('upcart_worker_url') ?? '';
    const storeUrl  = (() => {
      try { return JSON.parse(sessionStorage.getItem('upcart_tenant_ctx') || '{}').store_url ?? ''; } catch { return ''; }
    })();
    return { workerUrl, storeUrl };
  })();

  // The iframe src — point to the customer store
  const iframeSrc = auth.storeUrl ? `${auth.storeUrl.replace(/\/$/, '')}/index.html` : 'about:blank';

  // Post schema to iframe whenever it changes
  const postSchema = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'bst:schema', schema }, '*');
  }, [schema]);

  // Also post theme-only changes as lighter 'bst:preview' (compat with old theme.js)
  const postTheme = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    const cssVars = themeToCssVars(schema.globalTheme);
    frame.contentWindow.postMessage({ type: 'bst:preview', settings: { _themeVars: cssVars } }, '*');
  }, [schema.globalTheme]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const onLoad = () => {
      postSchema();
      postTheme();
    };
    frame.addEventListener('load', onLoad);
    return () => frame.removeEventListener('load', onLoad);
  }, [postSchema, postTheme]);

  // Post on every schema change (debounced in production; direct here for simplicity)
  useEffect(() => { postSchema(); }, [postSchema]);

  // Listen for section clicks from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'bst:select-section') {
        selectSection(e.data.sectionId);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [selectSection]);

  const width = VIEWPORT_WIDTHS[viewport];

  return (
    <div className="flex-1 flex flex-col items-center justify-start overflow-auto py-4 bg-ed-bg w-full h-full">
      <div
        className="relative transition-all duration-300 bg-white shadow-2xl"
        style={{ width, minWidth: viewport === 'desktop' ? 0 : width, maxWidth: '100%' }}
      >
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
