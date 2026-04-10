import { useEffect } from 'react';

import { Kbd, type KbdVariant } from '@superagent/ui';

export { Kbd, type KbdVariant };

// ── focusLater ─────────────────────────────────────────────────────────────────
// Schedules a focus call in the next animation frame so it runs after the
// browser has committed the current render (avoids focus races on mount).

export function focusLater(ref: React.RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => ref.current?.focus());
}

// ── useScrollSelectedIntoView ──────────────────────────────────────────────────
// Scrolls the item matching `[data-id="${selectedId}"]` into view whenever
// the selection changes. Requires list items to carry a `data-id` attribute.

export function useScrollSelectedIntoView(
  listRef: React.RefObject<HTMLElement | null>,
  selectedId: string | null,
): void {
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, listRef]);
}

// ── SectionHeader ──────────────────────────────────────────────────────────────

export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-2 pb-1 font-mono text-2xs font-medium tracking-widest text-text-faint uppercase">
      {label}
    </div>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────────
// FooterBar  — outer container (bg, border, padding, font, color)
// FooterHint — a single hint: one or more Kbd keys + a text label
// FooterSep  — separator dot between hints

export function FooterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-bg-primary/40 px-3 py-2 text-sm text-text-muted/60">
      {children}
    </div>
  );
}

export function FooterHint({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {children} {label}
    </span>
  );
}

export function FooterSep() {
  return <span>·</span>;
}
