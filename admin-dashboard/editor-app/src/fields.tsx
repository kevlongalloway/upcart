/* =================================================================
   Upcart Store Editor — Field Components
   All reusable field UI components used by the properties panel.
================================================================= */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Upload, Link, ChevronDown, RotateCcw } from 'lucide-react';
import type {
  FieldDef, Spacing, Background, Typography, ButtonStyle, FontWeight,
} from './types';
import { DEFAULT_SPACING, DEFAULT_BACKGROUND, DEFAULT_TYPOGRAPHY, DEFAULT_BUTTON } from './types';
import { uploadImage } from './api';
import { GOOGLE_FONTS, loadGoogleFont } from './utils';

// ── Helpers ────────────────────────────────────────────────────────────────

function Row({ label, children, tight = false }: {
  label?: string; children: React.ReactNode; tight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${tight ? 'mb-1' : 'mb-2'}`}>
      {label && <label className="text-ed-muted text-[11px] w-24 flex-shrink-0">{label}</label>}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-ed-muted mb-2 mt-3 first:mt-0 border-b border-ed-border pb-1">
      {label}
    </div>
  );
}

// ── Color picker ───────────────────────────────────────────────────────────

export function ColorField({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const display = value || '#000000';

  return (
    <div className="flex items-center gap-2" ref={ref}>
      {label && <label className="text-ed-muted text-[11px] w-24 flex-shrink-0">{label}</label>}
      <div className="flex items-center gap-1.5 flex-1">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-7 h-7 rounded border border-ed-border flex-shrink-0"
          style={{ background: display }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 text-xs"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 top-full left-0 bg-ed-panel border border-ed-border rounded-lg p-3 shadow-xl">
          <HexColorPicker color={display} onChange={onChange} />
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="mt-2 w-full text-xs"
          />
        </div>
      )}
    </div>
  );
}

// ── Inline color (no label row overhead) ──────────────────────────────────

export function InlineColorPicker({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-6 h-6 rounded border border-ed-border"
        style={{ background: value || '#000000' }}
        title={value}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-ed-panel border border-ed-border rounded-lg p-3 shadow-xl">
          <HexColorPicker color={value || '#000000'} onChange={onChange} />
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="mt-2 w-full text-xs"
          />
        </div>
      )}
    </div>
  );
}

// ── Text field ────────────────────────────────────────────────────────────

export function TextField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  return (
    <Row label={def.label}>
      <input
        type="text"
        value={String(value ?? '')}
        placeholder={def.placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full text-xs"
      />
    </Row>
  );
}

// ── Textarea ──────────────────────────────────────────────────────────────

export function TextareaField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  return (
    <div className="mb-2">
      <label className="text-ed-muted text-[11px] block mb-1">{def.label}</label>
      <textarea
        value={String(value ?? '')}
        placeholder={def.placeholder}
        rows={3}
        onChange={e => onChange(e.target.value)}
        className="w-full resize-y text-xs"
      />
    </div>
  );
}

// ── Rich text (contenteditable) ───────────────────────────────────────────

export function RichTextField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== String(value ?? '')) {
      ref.current.innerHTML = String(value ?? '');
    }
  }, [value]);

  return (
    <div className="mb-2">
      <label className="text-ed-muted text-[11px] block mb-1">{def.label}</label>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={() => onChange(ref.current?.innerHTML ?? '')}
        className="min-h-[60px] p-2 bg-ed-panel border border-ed-border rounded text-xs text-ed-text outline-none focus:border-ed-accent"
        dangerouslySetInnerHTML={{ __html: String(value ?? '') }}
      />
    </div>
  );
}

// ── Number ────────────────────────────────────────────────────────────────

export function NumberField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: number) => void;
}) {
  return (
    <Row label={def.label}>
      <input
        type="number"
        value={value as number ?? 0}
        min={def.min}
        max={def.max}
        step={def.step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full text-xs"
      />
    </Row>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────

export function SliderField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: number) => void;
}) {
  const v = value as number ?? 0;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <label className="text-ed-muted text-[11px]">{def.label}</label>
        <span className="text-ed-muted text-[11px]">{v}</span>
      </div>
      <input
        type="range"
        min={def.min ?? 0}
        max={def.max ?? 100}
        step={def.step ?? 1}
        value={v}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────

export function SelectField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  return (
    <Row label={def.label}>
      <select value={String(value ?? '')} onChange={e => onChange(e.target.value)} className="w-full text-xs">
        {def.options?.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </Row>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────

export function ToggleField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: boolean) => void;
}) {
  const checked = Boolean(value);
  return (
    <div className="flex items-center justify-between mb-2">
      <label className="text-ed-muted text-[11px]">{def.label}</label>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-ed-accent' : 'bg-ed-border'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </button>
    </div>
  );
}

// ── Image upload ──────────────────────────────────────────────────────────

export function ImageField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }, [onChange]);

  return (
    <div className="mb-2">
      <label className="text-ed-muted text-[11px] block mb-1">{def.label}</label>
      {!!value && (
        <img
          src={String(value)}
          alt=""
          className="w-full h-24 object-cover rounded mb-1 border border-ed-border"
        />
      )}
      <div className="flex gap-1">
        <input
          type="url"
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          placeholder="https://…"
          className="flex-1 text-xs"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1 bg-ed-panel hover:bg-ed-border rounded border border-ed-border text-ed-muted hover:text-ed-text text-xs transition-colors flex-shrink-0"
          title="Upload"
        >
          <Upload size={12} />
        </button>
      </div>
      {error && <p className="text-red-400 text-[11px] mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />
    </div>
  );
}

// ── URL field ─────────────────────────────────────────────────────────────

export function UrlField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  return (
    <Row label={def.label}>
      <div className="flex items-center gap-1">
        <Link size={11} className="text-ed-muted flex-shrink-0" />
        <input
          type="url"
          value={String(value ?? '')}
          placeholder={def.placeholder ?? 'https://'}
          onChange={e => onChange(e.target.value)}
          className="flex-1 text-xs"
        />
      </div>
    </Row>
  );
}

// ── Spacing (4-side) ──────────────────────────────────────────────────────

export function SpacingField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: Spacing) => void;
}) {
  const sp: Spacing = (value as Spacing) ?? DEFAULT_SPACING;
  const [linked, setLinked] = useState(false);

  const update = (side: keyof Spacing, v: number) => {
    if (linked) {
      onChange({ top: v, right: v, bottom: v, left: v });
    } else {
      onChange({ ...sp, [side]: v });
    }
  };

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <label className="text-ed-muted text-[11px]">{def.label}</label>
        <button
          onClick={() => setLinked(l => !l)}
          title={linked ? 'Unlink sides' : 'Link all sides'}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${linked ? 'bg-ed-accent text-white' : 'bg-ed-panel text-ed-muted hover:text-ed-text'}`}
        >
          {linked ? 'Linked' : 'Link'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {(['top', 'right', 'bottom', 'left'] as (keyof Spacing)[]).map(side => (
          <div key={side} className="flex flex-col items-center gap-0.5">
            <input
              type="number"
              value={sp[side]}
              onChange={e => update(side, Number(e.target.value))}
              className="w-full text-xs text-center px-1"
            />
            <span className="text-[9px] text-ed-muted capitalize">{side.slice(0, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Background panel ──────────────────────────────────────────────────────

export function BackgroundPanel({ value, onChange }: {
  value: Background; onChange: (v: Background) => void;
}) {
  const bg = value ?? DEFAULT_BACKGROUND;
  const up = (patch: Partial<Background>) => onChange({ ...bg, ...patch });

  return (
    <div>
      <Row label="Type">
        <select value={bg.type} onChange={e => up({ type: e.target.value as Background['type'] })} className="w-full text-xs">
          <option value="color">Solid Color</option>
          <option value="gradient">Gradient</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </Row>

      {bg.type === 'color' && (
        <ColorField label="Color" value={bg.color} onChange={v => up({ color: v })} />
      )}

      {bg.type === 'gradient' && (
        <>
          <Row label="Gradient">
            <select value={bg.gradientType} onChange={e => up({ gradientType: e.target.value as Background['gradientType'] })} className="w-full text-xs">
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
          </Row>
          <ColorField label="From" value={bg.gradientFrom} onChange={v => up({ gradientFrom: v })} />
          <ColorField label="To"   value={bg.gradientTo}   onChange={v => up({ gradientTo: v })} />
          {bg.gradientType === 'linear' && (
            <Row label="Angle">
              <input type="number" value={bg.gradientAngle} min={0} max={360}
                onChange={e => up({ gradientAngle: Number(e.target.value) })} className="w-full text-xs" />
            </Row>
          )}
        </>
      )}

      {bg.type === 'image' && (
        <>
          <Row label="URL">
            <input type="url" value={bg.imageUrl} onChange={e => up({ imageUrl: e.target.value })}
              placeholder="https://…" className="w-full text-xs" />
          </Row>
          <Row label="Size">
            <select value={bg.backgroundSize} onChange={e => up({ backgroundSize: e.target.value as Background['backgroundSize'] })} className="w-full text-xs">
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="auto">Auto</option>
            </select>
          </Row>
          <Row label="Position">
            <input type="text" value={bg.backgroundPosition}
              onChange={e => up({ backgroundPosition: e.target.value })} className="w-full text-xs" />
          </Row>
          <ToggleField
            def={{ key: 'parallax', label: 'Parallax', type: 'toggle' }}
            value={bg.parallax}
            onChange={v => up({ parallax: v })}
          />
          <ColorField label="Overlay" value={bg.overlayColor} onChange={v => up({ overlayColor: v })} />
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-ed-muted text-[11px]">Overlay opacity</label>
              <span className="text-ed-muted text-[11px]">{Math.round(bg.overlayOpacity * 100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={bg.overlayOpacity}
              onChange={e => up({ overlayOpacity: Number(e.target.value) })} className="w-full" />
          </div>
        </>
      )}

      {bg.type === 'video' && (
        <>
          <Row label="Video URL">
            <input type="url" value={bg.videoUrl} onChange={e => up({ videoUrl: e.target.value })}
              placeholder="https://…mp4" className="w-full text-xs" />
          </Row>
          <ColorField label="Fallback" value={bg.color} onChange={v => up({ color: v })} />
          <ColorField label="Overlay" value={bg.overlayColor} onChange={v => up({ overlayColor: v })} />
        </>
      )}
    </div>
  );
}

// ── Typography panel ──────────────────────────────────────────────────────

export function TypographyPanel({ value, onChange }: {
  value: Typography; onChange: (v: Typography) => void;
}) {
  const t = value ?? DEFAULT_TYPOGRAPHY;
  const up = (patch: Partial<Typography>) => onChange({ ...t, ...patch });

  return (
    <div>
      <Row label="Font">
        <select value={t.fontFamily} onChange={e => { loadGoogleFont(e.target.value); up({ fontFamily: e.target.value }); }} className="w-full text-xs">
          <option value="inherit">Inherit</option>
          {GOOGLE_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </Row>
      <Row label="Size">
        <input type="number" value={t.fontSize} min={8} max={200} onChange={e => up({ fontSize: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Weight">
        <select value={t.fontWeight} onChange={e => up({ fontWeight: Number(e.target.value) as FontWeight })} className="w-full text-xs">
          {([300, 400, 500, 600, 700, 800] as FontWeight[]).map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </Row>
      <Row label="Align">
        <select value={t.textAlign} onChange={e => up({ textAlign: e.target.value as Typography['textAlign'] })} className="w-full text-xs">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
      </Row>
      <Row label="Transform">
        <select value={t.textTransform} onChange={e => up({ textTransform: e.target.value as Typography['textTransform'] })} className="w-full text-xs">
          <option value="none">None</option>
          <option value="uppercase">Uppercase</option>
          <option value="lowercase">Lowercase</option>
          <option value="capitalize">Capitalize</option>
        </select>
      </Row>
      <Row label="Line height">
        <input type="number" value={t.lineHeight} step={0.1} min={0.8} max={4} onChange={e => up({ lineHeight: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Letter spacing">
        <input type="number" value={t.letterSpacing} step={0.01} min={-0.1} max={0.5} onChange={e => up({ letterSpacing: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <ColorField label="Color" value={t.color} onChange={v => up({ color: v })} />
      <div className="flex gap-3 mt-1">
        <ToggleField def={{ key: 'italic', label: 'Italic', type: 'toggle' }} value={t.italic} onChange={v => up({ italic: v })} />
        <ToggleField def={{ key: 'underline', label: 'Underline', type: 'toggle' }} value={t.underline} onChange={v => up({ underline: v })} />
      </div>
    </div>
  );
}

// ── Button style field ────────────────────────────────────────────────────

export function ButtonStyleField({ value, onChange }: {
  value: ButtonStyle; onChange: (v: ButtonStyle) => void;
}) {
  const b = value ?? DEFAULT_BUTTON;
  const up = (patch: Partial<ButtonStyle>) => onChange({ ...b, ...patch });

  return (
    <div>
      <Row label="Label">
        <input type="text" value={b.label} onChange={e => up({ label: e.target.value })} className="w-full text-xs" />
      </Row>
      <Row label="URL">
        <input type="url" value={b.url} onChange={e => up({ url: e.target.value })} className="w-full text-xs" />
      </Row>
      <ToggleField def={{ key: 'openInNewTab', label: 'Open in new tab', type: 'toggle' }}
        value={b.openInNewTab} onChange={v => up({ openInNewTab: v })} />
      <Row label="Variant">
        <select value={b.variant} onChange={e => up({ variant: e.target.value as ButtonStyle['variant'] })} className="w-full text-xs">
          <option value="solid">Solid</option>
          <option value="outline">Outline</option>
          <option value="ghost">Ghost</option>
          <option value="link">Link</option>
        </select>
      </Row>
      <Row label="Size">
        <select value={b.size} onChange={e => up({ size: e.target.value as ButtonStyle['size'] })} className="w-full text-xs">
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
        </select>
      </Row>
      <ColorField label="BG" value={b.backgroundColor} onChange={v => up({ backgroundColor: v })} />
      <ColorField label="Text" value={b.textColor} onChange={v => up({ textColor: v })} />
      <ColorField label="Border" value={b.borderColor} onChange={v => up({ borderColor: v })} />
      <Row label="Border width">
        <input type="number" value={b.borderWidth} min={0} max={8} onChange={e => up({ borderWidth: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Border radius">
        <input type="number" value={b.borderRadius} min={0} max={100} onChange={e => up({ borderRadius: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Padding X">
        <input type="number" value={b.paddingX} min={0} max={80} onChange={e => up({ paddingX: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Padding Y">
        <input type="number" value={b.paddingY} min={0} max={60} onChange={e => up({ paddingY: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Font size">
        <input type="number" value={b.fontSize} min={10} max={32} onChange={e => up({ fontSize: Number(e.target.value) })} className="w-full text-xs" />
      </Row>
      <Row label="Shadow">
        <select value={b.shadow} onChange={e => up({ shadow: e.target.value as ButtonStyle['shadow'] })} className="w-full text-xs">
          <option value="none">None</option>
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
        </select>
      </Row>
      <ColorField label="Hover BG" value={b.hoverBackgroundColor} onChange={v => up({ hoverBackgroundColor: v })} />
      <ColorField label="Hover text" value={b.hoverTextColor} onChange={v => up({ hoverTextColor: v })} />
      <ToggleField def={{ key: 'fullWidth', label: 'Full width', type: 'toggle' }}
        value={b.fullWidth} onChange={v => up({ fullWidth: v })} />
    </div>
  );
}

// ── Font selector ─────────────────────────────────────────────────────────

export function FontField({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (v: string) => void;
}) {
  const fam = String(value ?? 'inherit');
  return (
    <Row label={def.label}>
      <select
        value={fam}
        onChange={e => { loadGoogleFont(e.target.value); onChange(e.target.value); }}
        className="w-full text-xs"
      >
        <option value="inherit">Default (inherit)</option>
        {GOOGLE_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </Row>
  );
}

// ── Custom CSS ────────────────────────────────────────────────────────────

export function CustomCSSField({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="mb-2">
      <label className="text-ed-muted text-[11px] block mb-1">Custom CSS</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder={`/* custom styles */\n.section {\n  border: 1px solid red;\n}`}
        className="w-full font-mono text-xs resize-y"
        spellCheck={false}
      />
    </div>
  );
}

// ── Generic field dispatcher ───────────────────────────────────────────────

export function FieldRenderer({ def, value, onChange }: {
  def: FieldDef; value: unknown; onChange: (key: string, v: unknown) => void;
}) {
  const up = useCallback((v: unknown) => onChange(def.key, v), [def.key, onChange]);

  switch (def.type) {
    case 'text':         return <TextField    def={def} value={value} onChange={up} />;
    case 'textarea':     return <TextareaField def={def} value={value} onChange={up} />;
    case 'richtext':     return <RichTextField def={def} value={value} onChange={up} />;
    case 'color':        return <ColorField   label={def.label} value={String(value ?? '')} onChange={up} />;
    case 'font':         return <FontField    def={def} value={value} onChange={up} />;
    case 'number':       return <NumberField  def={def} value={value} onChange={up} />;
    case 'slider':       return <SliderField  def={def} value={value} onChange={up} />;
    case 'select':       return <SelectField  def={def} value={value} onChange={up} />;
    case 'toggle':       return <ToggleField  def={def} value={value} onChange={v => up(v)} />;
    case 'image':        return <ImageField   def={def} value={value} onChange={up} />;
    case 'url':          return <UrlField     def={def} value={value} onChange={up} />;
    case 'spacing':      return <SpacingField def={def} value={value} onChange={up} />;
    case 'background':   return <BackgroundPanel value={(value as Background) ?? DEFAULT_BACKGROUND} onChange={up} />;
    case 'typography':   return <TypographyPanel  value={(value as Typography) ?? DEFAULT_TYPOGRAPHY}   onChange={up} />;
    case 'button-style': return <ButtonStyleField value={(value as ButtonStyle) ?? DEFAULT_BUTTON} onChange={up} />;
    case 'custom-css':   return <CustomCSSField value={String(value ?? '')} onChange={up} />;
    default:             return null;
  }
}

// Re-export helpers for panel use
export { Group, Row };
