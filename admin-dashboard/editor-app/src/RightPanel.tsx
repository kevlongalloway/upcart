/* =================================================================
   Upcart Store Editor — Right Properties Panel
================================================================= */

import React, { useCallback, useState } from 'react';
import { Plus, Trash2, Copy, GripVertical, Eye, EyeOff, Palette, Settings2, Code2 } from 'lucide-react';
import {
  DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditor } from './store';
import { getSectionDef } from './registry';
import type { Section, Block, SectionType, FieldDef, SectionLayout } from './types';
import {
  FieldRenderer, Group, ColorField, InlineColorPicker,
  SpacingField, BackgroundPanel, TypographyPanel,
  ToggleField, CustomCSSField,
} from './fields';
import { GOOGLE_FONTS, loadGoogleFont } from './utils';
import type { GlobalTheme, ThemePreset } from './types';
import { DEFAULT_GLOBAL_THEME } from './types';

// ── Helpers ────────────────────────────────────────────────────────────────

const PRESET_THEMES: Record<ThemePreset, Partial<GlobalTheme['colors']>> = {
  base:     { primary: '#111111', accent: '#f5c000', background: '#ffffff', text: '#111111' },
  mono:     { primary: '#000000', accent: '#333333', background: '#f9f9f9', text: '#000000' },
  minimal:  { primary: '#1a1a1a', accent: '#e8e0d8', background: '#fafaf8', text: '#1a1a1a' },
  boutique: { primary: '#c4a882', accent: '#d4b896', background: '#fdf8f3', text: '#3d2c1e' },
  bold:     { primary: '#ff3c00', accent: '#ffcc00', background: '#0a0a0a', text: '#ffffff' },
  studio:   { primary: '#2d5be3', accent: '#7c3aed', background: '#ffffff', text: '#1e1e1e' },
  custom:   {},
};

// ── Block row in section panel ─────────────────────────────────────────────

function SortableBlockRow({ sectionId, block }: { sectionId: string; block: Block }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  const selectBlock   = useEditor(s => s.selectBlock);
  const selectedBlockId = useEditor(s => s.selectedBlockId);
  const toggleVisible  = useEditor(s => s.toggleBlockVisible);
  const removeBlock    = useEditor(s => s.removeBlock);
  const duplicateBlock = useEditor(s => s.duplicateBlock);

  const isSelected = selectedBlockId === block.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      onClick={() => selectBlock(block.id)}
      className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-ed-accent/20' : 'hover:bg-ed-panel'
      } text-ed-muted`}
    >
      <button {...attributes} {...listeners} className="cursor-grab p-0.5" onClick={e => e.stopPropagation()}>
        <GripVertical size={11} />
      </button>
      <span className="flex-1 text-xs truncate">{block.type}</span>
      <div className={`flex gap-0.5 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button onClick={e => { e.stopPropagation(); toggleVisible(sectionId, block.id); }} className="p-0.5 hover:text-ed-text">
          {block.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button onClick={e => { e.stopPropagation(); duplicateBlock(sectionId, block.id); }} className="p-0.5 hover:text-ed-text">
          <Copy size={10} />
        </button>
        <button onClick={e => { e.stopPropagation(); removeBlock(sectionId, block.id); }} className="p-0.5 hover:text-red-400">
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
}

// ── Blocks manager ─────────────────────────────────────────────────────────

function BlocksManager({ section }: { section: Section }) {
  const addBlock     = useEditor(s => s.addBlock);
  const reorderBlocks = useEditor(s => s.reorderBlocks);
  const def = getSectionDef(section.type);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = section.blocks.map(b => b.id);
    reorderBlocks(section.id, arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <div className="mb-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={section.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {section.blocks.map(block => (
            <SortableBlockRow key={block.id} sectionId={section.id} block={block} />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add block buttons */}
      {def?.addableBlocks && def.addableBlocks.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {def.addableBlocks.map(bType => (
            <button
              key={bType}
              onClick={() => addBlock(section.id, bType)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ed-panel hover:bg-ed-border text-ed-muted hover:text-ed-text transition-colors"
            >
              <Plus size={10} /> {def.blockTypes?.[bType]?.name ?? bType}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section settings panel ─────────────────────────────────────────────────

function SectionSettingsPanel({ section }: { section: Section }) {
  const updateSettings = useEditor(s => s.updateSectionSettings);
  const updateLayout   = useEditor(s => s.updateSectionLayout);
  const updateCSS      = useEditor(s => s.updateSectionCSS);
  const [tab, setTab]  = useState<'content' | 'layout' | 'advanced'>('content');

  const def = getSectionDef(section.type);
  if (!def) return null;

  const handleChange = useCallback((key: string, v: unknown) => {
    // Layout fields are prefixed with "layout__" in the registry. Route them
    // to updateSectionLayout so they actually mutate section.layout instead of
    // silently landing in section.settings under a bogus key.
    if (key.startsWith('layout__')) {
      const layoutKey = key.slice('layout__'.length);
      updateLayout(section.id, { [layoutKey]: v } as Partial<SectionLayout>);
    } else {
      updateSettings(section.id, { [key]: v });
    }
  }, [section.id, updateSettings, updateLayout]);

  // Content tab shows only true content fields. Layout, custom-CSS, and
  // blocks-manager have their own dedicated tabs/UI below — including them
  // here produced duplicate (and historically broken) controls.
  const contentFields = def.settingsFields.filter(f =>
    f.type !== 'blocks-manager' &&
    f.type !== 'custom-css' &&
    !f.key.startsWith('layout__'),
  );
  const hasBlocks = def.settingsFields.some(f => f.type === 'blocks-manager');

  // Group content fields by their `group` property for collapsible sections.
  const grouped = contentFields.reduce<Record<string, FieldDef[]>>((acc, field) => {
    const g = field.group ?? '';
    (acc[g] ??= []).push(field);
    return acc;
  }, {});

  // Check condition. Conditions can reference either a settings field or a
  // layout field — try settings first, then fall back to layout.
  const isVisible = (field: FieldDef) => {
    if (!field.condition) return true;
    const k = field.condition.key;
    const condValue = k in section.settings
      ? section.settings[k]
      : (section.layout as unknown as Record<string, unknown>)[k];
    return condValue === field.condition.value;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-ed-border mb-3">
        {[
          { id: 'content' as const,  label: 'Content' },
          { id: 'layout'  as const,  label: 'Layout'  },
          { id: 'advanced' as const, label: 'CSS'     },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
              tab === t.id ? 'text-ed-text border-b-2 border-ed-accent' : 'text-ed-muted hover:text-ed-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'content' && (
          <div>
            {/* Blocks manager */}
            {hasBlocks && (
              <>
                <Group label="Blocks" />
                <BlocksManager section={section} />
              </>
            )}

            {/* Content fields, grouped */}
            {Object.entries(grouped).map(([groupName, fields]) => {
              const visible = fields.filter(isVisible).filter(f => f.type !== 'blocks-manager');
              if (!visible.length) return null;
              return (
                <div key={groupName}>
                  {groupName && <Group label={groupName} />}
                  {visible.map(field => (
                    <FieldRenderer
                      key={field.key}
                      def={field}
                      value={section.settings[field.key]}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'layout' && (
          <div>
            <Group label="Width & Alignment" />
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Width</label>
              <select
                value={section.layout.width}
                onChange={e => updateLayout(section.id, { width: e.target.value as SectionLayout['width'] })}
                className="w-full text-xs"
              >
                <option value="full">Full</option>
                <option value="wide">Wide</option>
                <option value="contained">Contained</option>
                <option value="narrow">Narrow</option>
              </select>
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Content align</label>
              <select
                value={section.layout.contentAlign}
                onChange={e => updateLayout(section.id, { contentAlign: e.target.value as SectionLayout['contentAlign'] })}
                className="w-full text-xs"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Min height (px)</label>
              <input
                type="number"
                value={section.layout.minHeight}
                min={0}
                onChange={e => updateLayout(section.id, { minHeight: Number(e.target.value) })}
                className="w-full text-xs"
              />
            </div>

            <Group label="Padding" />
            <SpacingField
              def={{ key: 'padding', label: 'Padding', type: 'spacing' }}
              value={section.layout.padding}
              onChange={v => updateLayout(section.id, { padding: v })}
            />

            <Group label="Margin" />
            <SpacingField
              def={{ key: 'margin', label: 'Margin', type: 'spacing' }}
              value={section.layout.margin}
              onChange={v => updateLayout(section.id, { margin: v })}
            />

            <Group label="Background" />
            <BackgroundPanel
              value={section.layout.background}
              onChange={v => updateLayout(section.id, { background: v })}
            />
          </div>
        )}

        {tab === 'advanced' && (
          <div>
            <Group label="Custom CSS" />
            <p className="text-ed-muted text-[11px] mb-2">
              CSS scoped to this section. Use <code className="bg-ed-panel px-1 rounded">.section</code> to target the wrapper.
            </p>
            <CustomCSSField
              value={section.customCSS}
              onChange={v => updateCSS(section.id, v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Block settings panel ───────────────────────────────────────────────────

function BlockSettingsPanel({ section, block }: { section: Section; block: Block }) {
  const updateBlockSettings = useEditor(s => s.updateBlockSettings);
  const sectionDef = getSectionDef(section.type);
  const blockDef   = sectionDef?.blockTypes?.[block.type];

  if (!blockDef) return <p className="text-ed-muted text-xs p-3">No block definition found.</p>;

  return (
    <div className="flex-1 overflow-y-auto">
      <p className="text-ed-muted text-[11px] mb-3">{blockDef.name} block</p>
      {blockDef.fields.map(field => (
        <FieldRenderer
          key={field.key}
          def={field}
          value={block.settings[field.key]}
          onChange={(key, v) => updateBlockSettings(section.id, block.id, { [key]: v })}
        />
      ))}
    </div>
  );
}

// ── Global Theme panel ─────────────────────────────────────────────────────

function GlobalThemePanel() {
  const schema      = useEditor(s => s.schema);
  const updateTheme = useEditor(s => s.updateTheme);
  const theme       = schema.globalTheme;
  const [tab, setTab] = useState<'colors' | 'type' | 'spacing' | 'css'>('colors');

  const upColors = (patch: Partial<GlobalTheme['colors']>) =>
    updateTheme({ colors: { ...theme.colors, ...patch } });
  const upType = (patch: Partial<GlobalTheme['typography']>) =>
    updateTheme({ typography: { ...theme.typography, ...patch } });
  const upSpacing = (patch: Partial<GlobalTheme['spacing']>) =>
    updateTheme({ spacing: { ...theme.spacing, ...patch } });

  const colorEntries: [keyof GlobalTheme['colors'], string][] = [
    ['primary',     'Primary'],
    ['primaryText', 'Primary Text'],
    ['secondary',   'Secondary'],
    ['accent',      'Accent'],
    ['background',  'Background'],
    ['surface',     'Surface'],
    ['text',        'Text'],
    ['textMuted',   'Text Muted'],
    ['border',      'Border'],
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Preset swatches */}
      <div className="p-3 border-b border-ed-border">
        <p className="text-ed-muted text-[11px] mb-2">Preset</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PRESET_THEMES) as ThemePreset[]).map(preset => (
            <button
              key={preset}
              onClick={() => {
                const colors = PRESET_THEMES[preset];
                if (Object.keys(colors).length) {
                  updateTheme({ preset, colors: { ...theme.colors, ...colors } });
                }
              }}
              className={`px-2 py-1 rounded text-[11px] capitalize transition-colors ${
                theme.preset === preset
                  ? 'bg-ed-accent text-white'
                  : 'bg-ed-panel text-ed-muted hover:text-ed-text hover:bg-ed-border'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-ed-border">
        {[
          { id: 'colors'  as const, label: 'Colors'  },
          { id: 'type'    as const, label: 'Fonts'   },
          { id: 'spacing' as const, label: 'Spacing' },
          { id: 'css'     as const, label: 'CSS'     },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
              tab === t.id ? 'text-ed-text border-b-2 border-ed-accent' : 'text-ed-muted hover:text-ed-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'colors' && (
          <div className="space-y-2">
            {colorEntries.map(([key, label]) => (
              <ColorField
                key={key}
                label={label}
                value={theme.colors[key]}
                onChange={v => upColors({ [key]: v })}
              />
            ))}
          </div>
        )}

        {tab === 'type' && (
          <div>
            <Group label="Fonts" />
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Heading font</label>
              <select
                value={theme.typography.headingFont}
                onChange={e => { loadGoogleFont(e.target.value); upType({ headingFont: e.target.value }); }}
                className="w-full text-xs"
              >
                <option value="inherit">Default</option>
                {GOOGLE_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Body font</label>
              <select
                value={theme.typography.bodyFont}
                onChange={e => { loadGoogleFont(e.target.value); upType({ bodyFont: e.target.value }); }}
                className="w-full text-xs"
              >
                <option value="inherit">Default</option>
                {GOOGLE_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <Group label="Sizes & Weights" />
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Base font size (px)</label>
              <input type="number" value={theme.typography.baseFontSize} min={10} max={24}
                onChange={e => upType({ baseFontSize: Number(e.target.value) })} className="w-full text-xs" />
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Heading weight</label>
              <select value={theme.typography.headingWeight}
                onChange={e => upType({ headingWeight: Number(e.target.value) as GlobalTheme['typography']['headingWeight'] })}
                className="w-full text-xs">
                {[300, 400, 500, 600, 700, 800].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Body weight</label>
              <select value={theme.typography.bodyWeight}
                onChange={e => upType({ bodyWeight: Number(e.target.value) as GlobalTheme['typography']['bodyWeight'] })}
                className="w-full text-xs">
                {[300, 400, 500, 600, 700].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <label className="text-ed-muted text-[11px] block mb-1">Line height</label>
              <input type="number" value={theme.typography.lineHeight} step={0.1} min={1} max={3}
                onChange={e => upType({ lineHeight: Number(e.target.value) })} className="w-full text-xs" />
            </div>
          </div>
        )}

        {tab === 'spacing' && (
          <div>
            <Group label="Layout" />
            {[
              { key: 'containerMaxWidth' as const,      label: 'Container max width (px)', min: 640,  max: 2560 },
              { key: 'sectionVerticalPadding' as const, label: 'Section vertical padding (px)', min: 0, max: 200 },
              { key: 'borderRadius' as const,           label: 'Border radius (px)', min: 0, max: 32 },
              { key: 'cardBorderRadius' as const,       label: 'Card radius (px)', min: 0, max: 32 },
              { key: 'elementGap' as const,             label: 'Element gap (px)', min: 0, max: 80 },
            ].map(({ key, label, min, max }) => (
              <div key={key} className="mb-2">
                <label className="text-ed-muted text-[11px] block mb-1">{label}</label>
                <input
                  type="number"
                  value={theme.spacing[key]}
                  min={min}
                  max={max}
                  onChange={e => upSpacing({ [key]: Number(e.target.value) })}
                  className="w-full text-xs"
                />
              </div>
            ))}
          </div>
        )}

        {tab === 'css' && (
          <div>
            <p className="text-ed-muted text-[11px] mb-2">
              Global CSS injected into every page. CSS custom properties are already set from your theme colors.
            </p>
            <CustomCSSField
              value={theme.customCSS}
              onChange={v => updateTheme({ customCSS: v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right Panel ────────────────────────────────────────────────────────────

export default function RightPanel() {
  const rightTab         = useEditor(s => s.rightTab);
  const selectedSectionId = useEditor(s => s.selectedSectionId);
  const selectedBlockId   = useEditor(s => s.selectedBlockId);
  const sections         = useEditor(s => s.schema.pages[s.selectedPageId]?.sections ?? []);

  const section = sections.find(s => s.id === selectedSectionId) ?? null;
  const block   = section?.blocks.find(b => b.id === selectedBlockId) ?? null;

  return (
    <aside className="w-64 flex-shrink-0 bg-ed-surface border-l border-ed-border flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center border-b border-ed-border px-3 py-2 gap-2">
        {section ? (
          <>
            <Settings2 size={13} className="text-ed-muted" />
            <span className="text-xs font-medium text-ed-text truncate flex-1">
              {block ? block.type : section.label}
            </span>
          </>
        ) : (
          <>
            <Palette size={13} className="text-ed-muted" />
            <span className="text-xs font-medium text-ed-text">Theme</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {!section && <GlobalThemePanel />}
        {section && !block && (
          <div className="flex-1 overflow-hidden flex flex-col p-3">
            <SectionSettingsPanel section={section} />
          </div>
        )}
        {section && block && (
          <div className="flex-1 overflow-hidden flex flex-col p-3">
            <BlockSettingsPanel section={section} block={block} />
          </div>
        )}
      </div>
    </aside>
  );
}
