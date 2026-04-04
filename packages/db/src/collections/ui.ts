import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

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

// In-memory only — UI navigation state, not persisted
export const uiCollection = createCollection(
  localOnlyCollectionOptions<UiState, 'ui'>({
    getKey: () => 'ui',
    initialData: [INITIAL_UI_STATE],
  }),
);

export function getUiState(): UiState {
  return uiCollection.toArray[0] ?? INITIAL_UI_STATE;
}
