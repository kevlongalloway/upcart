/* =================================================================
   Upcart Store Editor — Theme apply modal

   Shown when a merchant picks a theme from the gallery. They choose, every
   time, between a full template swap (structure + content + tokens) and a
   restyle (keep my content, swap only the design tokens). Paid themes
   (price > 0) would gate behind a buy-flow here in the future — for now the
   apply buttons are always enabled and no payment is taken.
================================================================= */

import React from 'react';
import { X, LayoutTemplate, Palette } from 'lucide-react';
import { useEditor } from './store';
import type { ThemeManifest } from './types';
import { ThemeSwatch, priceLabel } from './ThemeSwatch';

export default function ThemeApplyModal({ manifest, onClose }: {
  manifest: ThemeManifest;
  onClose: () => void;
}) {
  const applyTheme = useEditor(s => s.applyTheme);

  const apply = (mode: 'full' | 'restyle') => {
    applyTheme(manifest, mode);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-ed-surface border border-ed-border rounded-lg shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Preview */}
        <div className="relative">
          <ThemeSwatch theme={manifest.schema.globalTheme} name={manifest.name} large />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1 rounded bg-black/30 text-white/80 hover:text-white"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Meta */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="text-ed-text text-sm font-semibold">{manifest.name}</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              manifest.price === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-ed-accent/20 text-ed-accent'
            }`}>
              {priceLabel(manifest.price)}
            </span>
          </div>
          <p className="text-ed-muted text-xs leading-relaxed mb-4">{manifest.description}</p>

          {/* Apply choices */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => apply('full')}
              className="flex items-start gap-2 w-full text-left p-2.5 rounded border border-ed-border hover:border-ed-accent hover:bg-ed-panel transition-colors"
            >
              <LayoutTemplate size={16} className="text-ed-accent mt-0.5 flex-shrink-0" />
              <span>
                <span className="block text-ed-text text-xs font-medium">Use full template</span>
                <span className="block text-ed-muted text-[11px]">Replace my sections, content, and styles with this theme.</span>
              </span>
            </button>
            <button
              onClick={() => apply('restyle')}
              className="flex items-start gap-2 w-full text-left p-2.5 rounded border border-ed-border hover:border-ed-accent hover:bg-ed-panel transition-colors"
            >
              <Palette size={16} className="text-ed-accent mt-0.5 flex-shrink-0" />
              <span>
                <span className="block text-ed-text text-xs font-medium">Apply styles only</span>
                <span className="block text-ed-muted text-[11px]">Keep my current sections and content, swap only the colors & fonts.</span>
              </span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="mt-3 w-full py-1.5 text-xs text-ed-muted hover:text-ed-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
