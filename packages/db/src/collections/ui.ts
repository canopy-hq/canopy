import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

import { setSetting } from './settings';

import type { Tab } from '../types';

// localStorage keys for synchronous nav-state persistence
export const NAV_KEY_TAB = 'ui:activeTabId';
export const NAV_KEY_CONTEXT = 'ui:activeContextId';
export const NAV_KEY_TABS = 'ui:tabs';

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_DEFAULT = 250;
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
  cloningProjectIds: string[];
  justStartedWorktreeId: string | null;
  pendingClaudeSession: { worktreeId: string; mode: 'bypass' | 'plan'; prompt?: string } | null;
}

const INITIAL_UI_STATE: UiState = {
  id: 'ui',
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
  creatingWorktreeIds: [],
  cloningProjectIds: [],
  justStartedWorktreeId: null,
  pendingClaudeSession: null,
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

/**
 * Synchronously persist activeTabId + activeContextId to localStorage.
 * Must be called at every call site that changes these values, because
 * TanStack DB's onUpdate callbacks are async and may not flush to SQLite
 * before a reload. Optionally snapshots tabs for the same reason.
 */
export function syncNavStateToLocalStorage(
  tabId: string,
  contextId: string,
  tabSnapshot?: Tab[],
): void {
  localStorage.setItem(NAV_KEY_TAB, tabId);
  localStorage.setItem(NAV_KEY_CONTEXT, contextId);
  if (tabSnapshot) {
    localStorage.setItem(NAV_KEY_TABS, JSON.stringify(tabSnapshot));
  }
}
