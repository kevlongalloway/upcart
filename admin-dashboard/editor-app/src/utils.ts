/* =================================================================
   Upcart Store Editor — CSS / helper utilities
================================================================= */

import type { CSSProperties } from 'react';
import type { Spacing, Background, Typography, ButtonStyle, GlobalTheme } from './types';

// ── Spacing ────────────────────────────────────────────────────────────────

export function spacingToCss(s: Spacing, prop: 'padding' | 'margin' = 'padding'): string {
  return `${prop}: ${s.top}px ${s.right}px ${s.bottom}px ${s.left}px;`;
}

export function spacingToStyle(s: Spacing): CSSProperties {
  return { paddingTop: s.top, paddingRight: s.right, paddingBottom: s.bottom, paddingLeft: s.left };
}

// ── Background ────────────────────────────────────────────────────────────

export function bgToCss(bg: Background): string {
  const lines: string[] = [];
  switch (bg.type) {
    case 'color':
      lines.push(`background-color: ${bg.color};`);
      break;
    case 'gradient':
      if (bg.gradientType === 'radial') {
        lines.push(`background: radial-gradient(circle, ${bg.gradientFrom}, ${bg.gradientTo});`);
      } else {
        lines.push(`background: linear-gradient(${bg.gradientAngle}deg, ${bg.gradientFrom}, ${bg.gradientTo});`);
      }
      break;
    case 'image':
      if (bg.imageUrl) {
        lines.push(`background-image: url(${JSON.stringify(bg.imageUrl)});`);
        lines.push(`background-size: ${bg.backgroundSize};`);
        lines.push(`background-position: ${bg.backgroundPosition};`);
        lines.push(`background-repeat: no-repeat;`);
        if (bg.parallax) lines.push('background-attachment: fixed;');
        if (bg.overlayOpacity > 0) {
          // overlay handled separately via ::before in renderer
        }
      }
      break;
    case 'video':
      lines.push(`background-color: ${bg.color};`);
      break;
  }
  return lines.join('\n');
}

// ── Typography ────────────────────────────────────────────────────────────

export function typographyToCss(t: Typography): string {
  const lines: string[] = [];
  if (t.fontFamily && t.fontFamily !== 'inherit') lines.push(`font-family: '${t.fontFamily}', sans-serif;`);
  lines.push(`font-size: ${t.fontSize}px;`);
  lines.push(`font-weight: ${t.fontWeight};`);
  lines.push(`line-height: ${t.lineHeight};`);
  if (t.letterSpacing) lines.push(`letter-spacing: ${t.letterSpacing}em;`);
  lines.push(`text-align: ${t.textAlign};`);
  if (t.textTransform !== 'none') lines.push(`text-transform: ${t.textTransform};`);
  if (t.color) lines.push(`color: ${t.color};`);
  if (t.italic) lines.push('font-style: italic;');
  if (t.underline) lines.push('text-decoration: underline;');
  return lines.join('\n');
}

// ── Button ────────────────────────────────────────────────────────────────

export function buttonToCss(b: ButtonStyle, selector = '.btn-custom'): string {
  const base = `
${selector} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: ${b.fontSize}px;
  font-weight: ${b.fontWeight};
  padding: ${b.paddingY}px ${b.paddingX}px;
  border-radius: ${b.borderRadius}px;
  border: ${b.borderWidth}px solid ${b.borderColor};
  background-color: ${b.variant === 'outline' || b.variant === 'ghost' ? 'transparent' : b.backgroundColor};
  color: ${b.variant === 'outline' || b.variant === 'ghost' ? b.borderColor : b.textColor};
  cursor: pointer;
  text-decoration: ${b.variant === 'link' ? 'underline' : 'none'};
  width: ${b.fullWidth ? '100%' : 'auto'};
  transition: background-color 0.2s, color 0.2s;
}
${selector}:hover {
  background-color: ${b.hoverBackgroundColor};
  color: ${b.hoverTextColor};
}`.trim();
  return base;
}

// ── Global Theme → CSS custom properties ─────────────────────────────────

export function themeToCssVars(theme: GlobalTheme): string {
  const c = theme.colors;
  const t = theme.typography;
  const sp = theme.spacing;
  return `:root {
  --uc-primary:       ${c.primary};
  --uc-primary-text:  ${c.primaryText};
  --uc-secondary:     ${c.secondary};
  --uc-accent:        ${c.accent};
  --uc-bg:            ${c.background};
  --uc-surface:       ${c.surface};
  --uc-text:          ${c.text};
  --uc-text-muted:    ${c.textMuted};
  --uc-border:        ${c.border};
  --uc-heading-font:  ${t.headingFont === 'inherit' ? 'inherit' : `'${t.headingFont}', sans-serif`};
  --uc-body-font:     ${t.bodyFont === 'inherit' ? 'inherit' : `'${t.bodyFont}', sans-serif`};
  --uc-base-font-size: ${t.baseFontSize}px;
  --uc-heading-weight: ${t.headingWeight};
  --uc-body-weight:    ${t.bodyWeight};
  --uc-line-height:    ${t.lineHeight};
  --uc-letter-spacing: ${t.letterSpacing}em;
  --uc-container-max:  ${sp.containerMaxWidth}px;
  --uc-section-pad:    ${sp.sectionVerticalPadding}px;
  --uc-radius:         ${sp.borderRadius}px;
  --uc-card-radius:    ${sp.cardBorderRadius}px;
  --uc-gap:            ${sp.elementGap}px;
}`;
}

// ── Google Fonts ──────────────────────────────────────────────────────────

const loadedFonts = new Set<string>();

export function loadGoogleFont(family: string): void {
  if (!family || family === 'inherit' || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

export function loadGoogleFonts(families: string[]): void {
  families.forEach(loadGoogleFont);
}

export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway',
  'Nunito', 'Source Sans 3', 'Oswald', 'Merriweather', 'Playfair Display',
  'DM Sans', 'DM Serif Display', 'Cormorant Garamond', 'Libre Baskerville',
  'EB Garamond', 'Josefin Sans', 'Work Sans', 'Outfit', 'Plus Jakarta Sans',
  'Space Grotesk', 'Syne', 'Bricolage Grotesque', 'Bebas Neue',
];

// ── Deep set for nested key paths ─────────────────────────────────────────

export function deepSet<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const keys = path.split('.');
  if (keys.length === 1) return { ...obj, [path]: value };
  const [head, ...rest] = keys;
  return {
    ...obj,
    [head]: deepSet((obj[head] ?? {}) as Record<string, unknown>, rest.join('.'), value),
  };
}

// ── Misc ──────────────────────────────────────────────────────────────────

export function clsx(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ');
}

