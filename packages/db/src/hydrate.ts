import { hydrateSessionCollection } from './collections/sessions';
import { hydrateSettingCollection, getSetting } from './collections/settings';
import { getSettingCollection } from './collections/settings';
import { hydrateTabCollection } from './collections/tabs';
import { getTabCollection } from './collections/tabs';
import { uiCollection, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from './collections/ui';
import { hydrateWorkspaceCollection } from './collections/workspaces';

/**
 * Load all persisted data from SQLite into their in-memory collections.
 * Must be called after initDb() + runMigrations() and before rendering React.
 */
export async function hydrateCollections(): Promise<void> {
  // Settings must be hydrated first — restoreUiState reads from them
  await hydrateSettingCollection();
  await Promise.all([
    hydrateWorkspaceCollection(),
    hydrateTabCollection(),
    hydrateSessionCollection(),
  ]);
  restoreUiState();
}

function restoreUiState(): void {
  const settings = getSettingCollection().toArray;
  const savedContextId = getSetting(settings, 'activeContextId', '');
  const savedTabId = getSetting(settings, 'activeTabId', '');
  const savedSelectedItemId = getSetting<string | null>(settings, 'selectedItemId', null);
  const sidebarVisible = getSetting(settings, 'sidebarVisible', true);
  const sidebarWidth = getSetting(settings, 'sidebarWidth', SIDEBAR_WIDTH_MAX);

  const tabs = getTabCollection().toArray;

  // 1. Exact match: saved tab belongs to saved context
  let activeTab =
    savedContextId && savedTabId
      ? (tabs.find((t) => t.id === savedTabId && t.workspaceItemId === savedContextId) ?? null)
      : null;

  // 2. Tab found but context mismatch → derive context from the tab
  if (!activeTab && savedTabId) {
    activeTab = tabs.find((t) => t.id === savedTabId) ?? null;
  }

  // 3. No matching tab → find any tab for the saved context
  if (!activeTab && savedContextId) {
    activeTab = tabs.find((t) => t.workspaceItemId === savedContextId) ?? null;
  }

  uiCollection.update('ui', (draft) => {
    draft.sidebarVisible = sidebarVisible;
    draft.sidebarWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, sidebarWidth));
    if (activeTab) {
      draft.activeContextId = activeTab.workspaceItemId;
      draft.activeTabId = activeTab.id;
      draft.selectedItemId = savedSelectedItemId ?? activeTab.workspaceItemId;
    } else if (savedContextId) {
      // Context saved but no tabs — still navigate to the workspace (shows EmptyState)
      draft.activeContextId = savedContextId;
      draft.selectedItemId = savedSelectedItemId ?? savedContextId;
    }
  });
}
