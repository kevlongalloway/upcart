/* =================================================================
   Upcart Store Editor — Theme swatch

   A self-contained visual preview generated from a theme's globalTheme
   tokens (no image asset required). Used on gallery cards and in the apply
   modal so themes are recognisable at a glance even before screenshots exist.
================================================================= */

import React from 'react';
import type { GlobalTheme } from './types';

export function priceLabel(price: number): string {
  if (!price || price <= 0) return 'Free';
  // price is in minor units (cents)
  return `$${(price / 100).toFixed(price % 100 === 0 ? 0 : 2)}`;
}

export function ThemeSwatch({ theme, name, large = false }: {
  theme: GlobalTheme;
  name: string;
  large?: boolean;
}) {
  const c = theme.colors;
  const headingFont = theme.typography.headingFont;
  const bodyFont = theme.typography.bodyFont;
  const ff = (f: string) => (f && f !== 'inherit' ? `'${f}', serif` : 'inherit');

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        background: c.background,
        height: large ? 160 : 84,
        borderRadius: large ? 0 : 4,
      }}
    >
      {/* top bar / header */}
      <div
        className="flex items-center justify-between px-3"
        style={{ background: c.surface, height: large ? 28 : 18, borderBottom: `1px solid ${c.border}` }}
      >
        <span style={{ color: c.text, fontFamily: ff(headingFont), fontSize: large ? 11 : 8, letterSpacing: '.08em' }}>
          {name}
        </span>
        <span style={{ width: large ? 22 : 14, height: 4, background: c.accent, borderRadius: 2 }} />
      </div>

      {/* hero block */}
      <div className="px-3" style={{ paddingTop: large ? 16 : 8 }}>
        <div style={{ color: c.textMuted, fontFamily: ff(bodyFont), fontSize: large ? 8 : 6, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          New Collection
        </div>
        <div style={{ color: c.text, fontFamily: ff(headingFont), fontSize: large ? 24 : 14, fontWeight: theme.typography.headingWeight, lineHeight: 1.1, marginTop: large ? 4 : 2 }}>
          Made for everyday
        </div>
        {/* button + accent swatches */}
        <div className="flex items-center gap-1.5" style={{ marginTop: large ? 12 : 6 }}>
          <span style={{ background: c.primary, color: c.primaryText, fontFamily: ff(bodyFont), fontSize: large ? 8 : 6, padding: large ? '4px 10px' : '2px 6px', borderRadius: theme.spacing.borderRadius }}>
            Shop
          </span>
          <span style={{ width: large ? 12 : 8, height: large ? 12 : 8, background: c.accent, borderRadius: '50%' }} />
          <span style={{ width: large ? 12 : 8, height: large ? 12 : 8, background: c.secondary, borderRadius: '50%' }} />
        </div>
      </div>
    </div>
  );
}
