import { hydrateProjectCollection } from './collections/projects';
import { hydrateSessionCollection } from './collections/sessions';
import { hydrateSettingCollection, getSetting } from './collections/settings';
import { getSettingCollection } from './collections/settings';
import { hydrateTabCollection } from './collections/tabs';
import { getTabCollection } from './collections/tabs';
import {
  uiCollection,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
} from './collections/ui';

import type { Tab } from './types';

/**
 * Load all persisted data from SQLite into their in-memory collections.
 * Must be called after initDb() + runMigrations() and before rendering React.
 */
export async function hydrateCollections(): Promise<void> {
  // Settings must be hydrated first — restoreUiState reads from them
  await hydrateSettingCollection();
  await Promise.all([
    hydrateProjectCollection(),
    hydrateTabCollection(),
    hydrateSessionCollection(),
  ]);
  restoreUiState();
}

function restoreUiState(): void {
  const settings = getSettingCollection().toArray;
  // Prefer localStorage (written synchronously at each call site) over SQLite (async, may be stale)
  const savedContextId =
    localStorage.getItem('ui:activeContextId') || getSetting(settings, 'activeContextId', '');
  const savedTabId =
    localStorage.getItem('ui:activeTabId') || getSetting(settings, 'activeTabId', '');
  const savedSelectedItemId = getSetting<string | null>(settings, 'selectedItemId', null);
  const sidebarVisible = getSetting(settings, 'sidebarVisible', true);
  const sidebarWidth = getSetting(settings, 'sidebarWidth', SIDEBAR_WIDTH_DEFAULT);

  // Recover tabs whose SQLite insert hadn't flushed before reload
  recoverUnflushedTabs();

  const tabs = getTabCollection().toArray;

  // 1. Exact match: saved tab belongs to saved context
  let activeTab =
    savedContextId && savedTabId
      ? (tabs.find((t) => t.id === savedTabId && t.projectItemId === savedContextId) ?? null)
      : null;

  // 2. Tab found but context mismatch → derive context from the tab
  if (!activeTab && savedTabId) {
    activeTab = tabs.find((t) => t.id === savedTabId) ?? null;
  }

  // 3. No matching tab → find any tab for the saved context
  if (!activeTab && savedContextId) {
    activeTab = tabs.find((t) => t.projectItemId === savedContextId) ?? null;
  }

  uiCollection.update('ui', (draft) => {
    draft.sidebarVisible = sidebarVisible;
    draft.sidebarWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, sidebarWidth));
    if (activeTab) {
      draft.activeContextId = activeTab.projectItemId;
      draft.activeTabId = activeTab.id;
      draft.selectedItemId = savedSelectedItemId ?? activeTab.projectItemId;
    } else if (savedContextId) {
      // Context saved but no tabs — still navigate to the workspace (shows EmptyState)
      draft.activeContextId = savedContextId;
      draft.selectedItemId = savedSelectedItemId ?? savedContextId;
    }
  });
}

/**
 * If tabs existed in memory at the time of a nav state sync but their SQLite
 * insert hadn't flushed, re-insert them from the localStorage snapshot.
 */
function recoverUnflushedTabs(): void {
  const raw = localStorage.getItem('ui:tabs');
  if (!raw) return;
  try {
    const snapshotTabs = JSON.parse(raw) as Tab[];
    const col = getTabCollection();
    const existingIds = new Set(col.toArray.map((t) => t.id));
    for (const tab of snapshotTabs) {
      if (!existingIds.has(tab.id)) {
        col.insert(tab);
      }
    }
  } catch {
    // Corrupt snapshot — ignore
  }
}
