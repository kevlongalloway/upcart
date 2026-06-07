import React, { useCallback, useState } from 'react';
import {
  Undo2, Redo2, Monitor, Tablet, Smartphone,
  Save, ExternalLink, ChevronLeft, Loader2, Eye, EyeOff,
  Sun, Moon, MonitorSmartphone,
} from 'lucide-react';
import { useEditor } from './store';
import { getAuth } from './api';
import { getThemeMode, setThemeMode, nextThemeMode, type ThemeMode } from './theme';
import type { Viewport } from './types';

const THEME_META: Record<ThemeMode, { icon: React.ReactNode; label: string }> = {
  auto:  { icon: <MonitorSmartphone size={14} />, label: 'Theme: Auto (system)' },
  light: { icon: <Sun  size={14} />,              label: 'Theme: Light' },
  dark:  { icon: <Moon size={14} />,              label: 'Theme: Dark' },
};

const VIEWPORTS: { id: Viewport; icon: React.ReactNode; label: string }[] = [
  { id: 'desktop', icon: <Monitor size={14} />, label: 'Desktop' },
  { id: 'tablet',  icon: <Tablet  size={14} />, label: 'Tablet'  },
  { id: 'mobile',  icon: <Smartphone size={14} />, label: 'Mobile' },
];

export default function TopBar() {
  const undo        = useEditor(s => s.undo);
  const redo        = useEditor(s => s.redo);
  const canUndo     = useEditor(s => s.canUndo());
  const canRedo     = useEditor(s => s.canRedo());
  const viewport    = useEditor(s => s.viewport);
  const setViewport = useEditor(s => s.setViewport);
  const isDirty     = useEditor(s => s.isDirty);
  const isSaving    = useEditor(s => s.isSaving);
  const saveSchema  = useEditor(s => s.saveSchema);
  const storeName   = getAuth()?.storeName ?? 'My Store';
  const storeUrl    = getAuth()?.storeUrl ?? '#';

  const [saveError, setSaveError] = useState<string | null>(null);
  const [theme, setTheme]         = useState<ThemeMode>(getThemeMode);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try { await saveSchema(); }
    catch (err) { setSaveError(String(err)); }
  }, [saveSchema]);

  const cycleTheme = useCallback(() => {
    setTheme(prev => {
      const next = nextThemeMode(prev);
      setThemeMode(next);
      return next;
    });
  }, []);

  return (
    <header className="flex items-center gap-2 h-11 px-3 bg-ed-surface border-b border-ed-border flex-shrink-0 z-20">
      {/* Back */}
      <a
        href="/"
        className="flex items-center gap-1 text-ed-muted hover:text-ed-text transition-colors text-xs"
      >
        <ChevronLeft size={14} />
        <span className="hidden sm:inline">Dashboard</span>
      </a>

      <div className="w-px h-4 bg-ed-border mx-1" />

      {/* Store name */}
      <span className="text-xs font-medium text-ed-text truncate max-w-[140px]">
        {storeName}
      </span>

      <div className="flex-1" />

      {/* Undo / Redo */}
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="editor-btn p-1.5 disabled:opacity-30"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className="editor-btn p-1.5 disabled:opacity-30"
      >
        <Redo2 size={14} />
      </button>

      <div className="w-px h-4 bg-ed-border mx-1" />

      {/* Viewport toggles */}
      <div className="flex items-center bg-ed-panel rounded-md overflow-hidden border border-ed-border">
        {VIEWPORTS.map(vp => (
          <button
            key={vp.id}
            onClick={() => setViewport(vp.id)}
            title={vp.label}
            className={`px-2 py-1.5 transition-colors ${
              viewport === vp.id
                ? 'bg-ed-accent text-white'
                : 'text-ed-muted hover:text-ed-text'
            }`}
          >
            {vp.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-ed-border mx-1" />

      {/* Theme switcher (auto → light → dark) */}
      <button
        onClick={cycleTheme}
        title={THEME_META[theme].label}
        aria-label={THEME_META[theme].label}
        className="editor-btn p-1.5"
      >
        {THEME_META[theme].icon}
      </button>

      <div className="w-px h-4 bg-ed-border mx-1" />

      {/* Open store */}
      {storeUrl && storeUrl !== '#' && (
        <a
          href={storeUrl}
          target="_blank"
          rel="noreferrer"
          className="editor-btn p-1.5"
          title="Open store"
        >
          <ExternalLink size={14} />
        </a>
      )}

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          isDirty && !isSaving
            ? 'bg-ed-accent hover:bg-blue-600 text-white'
            : 'bg-ed-panel text-ed-muted cursor-default'
        }`}
      >
        {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        {isSaving ? 'Saving…' : 'Save'}
      </button>

      {saveError && (
        <span className="text-xs text-red-400 ml-1 truncate max-w-[160px]" title={saveError}>
          {saveError}
        </span>
      )}
    </header>
  );
}
