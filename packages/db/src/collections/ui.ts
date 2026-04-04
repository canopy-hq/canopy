import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

import { setSetting } from './settings';

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
}

const INITIAL_UI_STATE: UiState = {
  id: 'ui',
  sidebarVisible: true,
  sidebarWidth: 400,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
};

export const uiCollection = createCollection(
  localOnlyCollectionOptions<UiState, 'ui'>({
    getKey: () => 'ui',
    initialData: [INITIAL_UI_STATE],
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const old = m.original as UiState;
        const next = m.modified as UiState;
        if (old.activeTabId !== next.activeTabId) setSetting('activeTabId', next.activeTabId);
        if (old.activeContextId !== next.activeContextId)
          setSetting('activeContextId', next.activeContextId);
        if (old.sidebarVisible !== next.sidebarVisible)
          setSetting('sidebarVisible', next.sidebarVisible);
      }
    },
  }),
);

export function getUiState(): UiState {
  return uiCollection.toArray[0] ?? INITIAL_UI_STATE;
}
