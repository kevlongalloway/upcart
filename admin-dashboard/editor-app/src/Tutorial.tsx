/* =================================================================
   Upcart Store Editor — Onboarding Tutorial

   A lightweight, self-contained coach-mark that walks a first-time
   merchant through making one edit and saving. It activates only when
   the editor is opened with `?tutorial=customize` (the "Customize your
   store" step of the dashboard setup checklist links here).

   Completion is detected by watching the editor store: when a save
   finishes successfully (isSaving false, isDirty false after a save),
   we mark the step done in localStorage and offer a one-click return to
   the dashboard. The dashboard also derives completion server-side from
   a non-empty `page_sections`, so this flag is just a fast local hint.
================================================================= */

import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, ChevronRight, ChevronLeft, X, Check, ArrowUpRight,
} from 'lucide-react';
import { useEditor } from './store';

const DASHBOARD_URL = '/#/dashboard';
const DONE_KEY      = 'upcart_setup_customize';

function tutorialRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('tutorial') === 'customize';
  } catch {
    return false;
  }
}

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Welcome to your store editor',
    body:  "This is where you design your storefront. Let's make one quick change together — it only takes a minute.",
  },
  {
    title: 'Pick a section to edit',
    body:  'Click any section in the canvas, or use the Sections list on the left. Try selecting the Hero at the top of your page.',
  },
  {
    title: 'Make it yours',
    body:  'Use the panel on the right to edit text, colors, and images. Update your hero headline or brand color so the store feels like you.',
  },
  {
    title: 'Save to finish',
    body:  "When you're happy, click the blue Save button in the top-right corner. Saving completes this step automatically.",
  },
];

export default function Tutorial() {
  const [active, setActive]       = useState<boolean>(tutorialRequested);
  const [step, setStep]           = useState(0);
  const [completed, setCompleted] = useState(false);

  const isSaving   = useEditor(s => s.isSaving);
  const isDirty    = useEditor(s => s.isDirty);
  const prevSaving = useRef(false);

  // Detect a successful save while the tutorial is active. A save flips
  // isSaving true → false and clears isDirty; loads never touch isSaving.
  useEffect(() => {
    if (active && prevSaving.current && !isSaving && !isDirty) {
      try { localStorage.setItem(DONE_KEY, 'done'); } catch { /* ignore */ }
      setCompleted(true);
    }
    prevSaving.current = isSaving;
  }, [isSaving, isDirty, active]);

  if (!active) return null;

  // ── Completed state ──────────────────────────────────────────────
  if (completed) {
    return (
      <div className="fixed bottom-4 left-4 z-[60] w-80 rounded-lg border border-ed-success/40 bg-ed-surface shadow-2xl overflow-hidden">
        <div className="h-1 bg-ed-success" />
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-ed-success/15 text-ed-success">
              <Check size={16} />
            </span>
            <h3 className="text-md font-semibold text-ed-text">Store customized!</h3>
          </div>
          <p className="text-sm text-ed-text-2 mb-4">
            Nice work — your changes are live. You've completed the “Customize your store” step.
          </p>
          <div className="flex items-center gap-2">
            <a
              href={DASHBOARD_URL}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-ed-accent hover:bg-ed-accent-hover text-white transition-colors"
            >
              Return to dashboard <ArrowUpRight size={13} />
            </a>
            <button
              onClick={() => setActive(false)}
              className="px-3 py-2 rounded-md text-xs font-medium bg-ed-panel text-ed-muted hover:text-ed-text transition-colors"
            >
              Keep editing
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Walkthrough steps ────────────────────────────────────────────
  const s      = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-80 rounded-lg border border-ed-border bg-ed-surface shadow-2xl overflow-hidden">
      <div className="h-1 bg-ed-accent" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-ed-accent/15 text-ed-accent">
              <Sparkles size={15} />
            </span>
            <h3 className="text-md font-semibold text-ed-text">{s.title}</h3>
          </div>
          <button
            onClick={() => setActive(false)}
            title="Skip tutorial"
            className="text-ed-text-3 hover:text-ed-text transition-colors -mt-0.5"
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-sm text-ed-text-2 mb-4">{s.body}</p>

        {isLast && (
          <div className="flex items-center gap-1.5 mb-4 text-xs text-ed-warning">
            <ArrowUpRight size={13} />
            <span>Look for <strong>Save</strong> in the top-right corner.</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-4 bg-ed-accent' : 'w-1.5 bg-ed-border2'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-ed-panel text-ed-muted hover:text-ed-text transition-colors"
              >
                <ChevronLeft size={13} /> Back
              </button>
            )}
            {!isLast && (
              <button
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-ed-accent hover:bg-ed-accent-hover text-white transition-colors"
              >
                Next <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
