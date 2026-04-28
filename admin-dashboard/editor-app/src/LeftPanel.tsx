import React, { useState, useCallback } from 'react';
import {
  DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Layers, Plus, GripVertical, Eye, EyeOff, Trash2, Copy,
  ChevronDown, ChevronRight, Search,
} from 'lucide-react';
import { useEditor } from './store';
import { getAllSectionDefs, SECTION_CATEGORIES, CATEGORY_LABELS } from './registry';
import type { Section, SectionType, SectionCategory } from './types';
import * as LucideAll from 'lucide-react';

// ── Icon lookup ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _icons = LucideAll as unknown as Record<string, React.FC<any>>;

function SectionIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = _icons[name];
  return Icon ? <Icon size={size} /> : <Layers size={size} />;
}

// ── Sortable section row ────────────────────────────────────────────────────

function SortableRow({ section }: { section: Section }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });

  const selectedId       = useEditor(s => s.selectedSectionId);
  const selectSection    = useEditor(s => s.selectSection);
  const toggleVisible    = useEditor(s => s.toggleSectionVisible);
  const removeSection    = useEditor(s => s.removeSection);
  const duplicateSection = useEditor(s => s.duplicateSection);

  const isSelected = selectedId === section.id;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => selectSection(section.id)}
      className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-ed-accent/20 text-ed-text' : 'hover:bg-ed-panel text-ed-muted'
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 text-ed-muted/50 hover:text-ed-muted flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </button>

      <span className="flex-1 truncate text-xs leading-none py-0.5">
        {section.label}
      </span>

      {/* Actions — visible on hover/selection */}
      <div className={`flex items-center gap-0.5 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          title={section.visible ? 'Hide' : 'Show'}
          onClick={e => { e.stopPropagation(); toggleVisible(section.id); }}
          className="p-0.5 hover:text-ed-text transition-colors"
        >
          {section.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        {!section.locked && (
          <>
            <button
              title="Duplicate"
              onClick={e => { e.stopPropagation(); duplicateSection(section.id); }}
              className="p-0.5 hover:text-ed-text transition-colors"
            >
              <Copy size={11} />
            </button>
            <button
              title="Remove"
              onClick={e => { e.stopPropagation(); removeSection(section.id); }}
              className="p-0.5 hover:text-red-400 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Section library ────────────────────────────────────────────────────────

function SectionLibrary({ onAdd }: { onAdd: (type: SectionType) => void }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const all = getAllSectionDefs();

  const filtered = query
    ? all.filter(d => d.name.toLowerCase().includes(query.toLowerCase()) || d.description.toLowerCase().includes(query.toLowerCase()))
    : all;

  const CATS = Object.keys(SECTION_CATEGORIES) as SectionCategory[];
  const byCategory = CATS.reduce<Record<SectionCategory, typeof all>>((acc, cat) => {
    acc[cat] = filtered.filter(d => d.category === cat);
    return acc;
  }, {} as Record<SectionCategory, typeof all>);

  const toggle = (cat: string) =>
    setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ed-muted" />
        <input
          type="text"
          placeholder="Search sections…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-7 pr-2 py-1.5 w-full bg-ed-panel border border-ed-border rounded text-xs text-ed-text placeholder-ed-muted outline-none focus:border-ed-accent"
        />
      </div>

      {/* Categories */}
      {CATS.map(cat => {
        const defs = byCategory[cat];
        if (!defs.length) return null;
        const isOpen = expanded[cat] !== false; // default open
        return (
          <div key={cat}>
            <button
              onClick={() => toggle(cat)}
              className="flex items-center gap-1 w-full text-xs text-ed-muted hover:text-ed-text px-1 py-1 transition-colors"
            >
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <span className="uppercase tracking-wider font-medium text-[10px]">
                {CATEGORY_LABELS[cat]}
              </span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-1 mt-1">
                {defs.map(def => (
                  <button
                    key={def.type}
                    onClick={() => onAdd(def.type)}
                    className="flex flex-col items-center gap-1 p-2 rounded bg-ed-panel hover:bg-ed-border text-ed-muted hover:text-ed-text transition-colors text-center"
                  >
                    <SectionIcon name={def.icon} size={16} />
                    <span className="text-[10px] leading-tight">{def.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Left Panel ─────────────────────────────────────────────────────────────

export default function LeftPanel() {
  const leftTab      = useEditor(s => s.leftTab);
  const setLeftTab   = useEditor(s => s.setLeftTab);
  const selectedPageId = useEditor(s => s.selectedPageId);
  const pages        = useEditor(s => s.schema.pages);
  const sections     = useEditor(s => s.schema.pages[s.selectedPageId]?.sections ?? []);
  const addSection   = useEditor(s => s.addSection);
  const reorderSections = useEditor(s => s.reorderSections);
  const selectPage   = useEditor(s => s.selectPage);

  const [showLibrary, setShowLibrary] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sections.map(s => s.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    reorderSections(arrayMove(ids, oldIdx, newIdx));
  }, [sections, reorderSections]);

  const handleAdd = useCallback((type: SectionType) => {
    addSection(type, null);
    setShowLibrary(false);
    setLeftTab('sections');
  }, [addSection, setLeftTab]);

  return (
    <aside className="w-56 flex-shrink-0 bg-ed-surface border-r border-ed-border flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-ed-border">
        {[
          { id: 'sections' as const, label: 'Sections' },
          { id: 'library'  as const, label: 'Add' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setLeftTab(tab.id); setShowLibrary(tab.id === 'library'); }}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              leftTab === tab.id
                ? 'text-ed-text border-b-2 border-ed-accent'
                : 'text-ed-muted hover:text-ed-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Page selector */}
      {Object.keys(pages).length > 1 && (
        <div className="p-2 border-b border-ed-border">
          <select
            value={selectedPageId}
            onChange={e => selectPage(e.target.value)}
            className="w-full text-xs"
          >
            {Object.values(pages).map(page => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {(leftTab === 'sections' && !showLibrary) ? (
          <div className="p-2 flex flex-col gap-0.5">
            {sections.length === 0 && (
              <p className="text-ed-muted text-xs text-center py-6">
                No sections yet.<br />
                <button onClick={() => { setLeftTab('library'); setShowLibrary(true); }} className="text-ed-accent hover:underline">
                  Add a section
                </button>
              </p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {sections.map(sec => <SortableRow key={sec.id} section={sec} />)}
              </SortableContext>
            </DndContext>
          </div>
        ) : (
          <SectionLibrary onAdd={handleAdd} />
        )}
      </div>

      {/* Add section button (bottom of sections tab) */}
      {leftTab === 'sections' && !showLibrary && (
        <div className="p-2 border-t border-ed-border">
          <button
            onClick={() => { setLeftTab('library'); setShowLibrary(true); }}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded bg-ed-panel hover:bg-ed-border text-ed-muted hover:text-ed-text text-xs transition-colors"
          >
            <Plus size={13} /> Add Section
          </button>
        </div>
      )}
    </aside>
  );
}
