import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

import { setSetting } from './settings';

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 400;

export interface UiState {
  id: 'ui';
  // Sidebar
  sidebarVisible: boolean;
  sidebarWidth: number;
  selectedItemId: string | null;
  // Tab navigation
  activeTabId: string;
  activeContextId: string;
  contextActiveTabIds: Record<string, string>;
  // Ephemeral creation state (not persisted)
  creatingWorktreeIds: string[];
}

const INITIAL_UI_STATE: UiState = {
  id: 'ui',
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_MAX,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
  creatingWorktreeIds: [],
};

export const uiCollection = createCollection(
  localOnlyCollectionOptions<UiState, 'ui'>({
    getKey: () => 'ui',
    initialData: [INITIAL_UI_STATE],
    onUpdate: async ({ transaction }) => {
      const m = transaction.mutations[0];
      if (!m) return;
      const old = m.original as UiState;
      const next = m.modified as UiState;
      if (old.activeTabId !== next.activeTabId) setSetting('activeTabId', next.activeTabId);
      if (old.activeContextId !== next.activeContextId)
        setSetting('activeContextId', next.activeContextId);
      if (old.selectedItemId !== next.selectedItemId)
        setSetting('selectedItemId', next.selectedItemId);
      if (old.sidebarVisible !== next.sidebarVisible)
        setSetting('sidebarVisible', next.sidebarVisible);
      if (old.sidebarWidth !== next.sidebarWidth) setSetting('sidebarWidth', next.sidebarWidth);
    },
  }),
);

export function getUiState(): UiState {
  return uiCollection.toArray[0] ?? INITIAL_UI_STATE;
}
