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
  const activeContextId = getSetting(settings, 'activeContextId', '');
  const activeTabId = getSetting(settings, 'activeTabId', '');
  const sidebarVisible = getSetting(settings, 'sidebarVisible', true);
  const sidebarWidth = getSetting(settings, 'sidebarWidth', SIDEBAR_WIDTH_MAX);

  const tab =
    activeContextId && activeTabId
      ? getTabCollection().toArray.find(
          (t) => t.id === activeTabId && t.workspaceItemId === activeContextId,
        )
      : null;

  uiCollection.update('ui', (draft) => {
    draft.sidebarVisible = sidebarVisible;
    draft.sidebarWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, sidebarWidth));
    if (tab) {
      draft.activeContextId = activeContextId;
      draft.activeTabId = activeTabId;
    }
  });
}
