import { uiCollection } from '@canopy/db';

import type { NavEntry } from '@canopy/db';

const NAV_HISTORY_MAX = 50;

export function pushNav(entry: NavEntry, selectedItemId?: string): void {
  uiCollection.update('ui', (draft) => {
    if (selectedItemId !== undefined) draft.selectedItemId = selectedItemId;
    // Truncate forward history when branching
    if (draft.navIndex < draft.navHistory.length - 1) {
      draft.navHistory = draft.navHistory.slice(0, draft.navIndex + 1);
    }
    draft.navHistory.push(entry);
    if (draft.navHistory.length > NAV_HISTORY_MAX) {
      draft.navHistory = draft.navHistory.slice(-NAV_HISTORY_MAX);
    }
    draft.navIndex = draft.navHistory.length - 1;
  });
}

/** Derive the display label from a composite contextId + its parent project. */
export function deriveContextLabel(contextId: string, proj: { id: string; name: string }): string {
  return contextId.includes(`${proj.id}-branch-`)
    ? (contextId.split(`${proj.id}-branch-`)[1] ?? contextId)
    : contextId.includes(`${proj.id}-wt-`)
      ? (contextId.split(`${proj.id}-wt-`)[1] ?? contextId)
      : proj.name;
}
