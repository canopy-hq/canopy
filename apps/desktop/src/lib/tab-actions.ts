import {
  getTabCollection,
  getWorkspaceCollection,
  uiCollection,
  getUiState,
  setSetting,
} from '@superagent/db';

import {
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate as navFn,
  updateRatio as updateRatioFn,
  type PaneId,
  type SplitDirection,
} from './pane-tree-ops';

import type { Tab } from '@superagent/db';

/** Resolve a workspaceItemId composite key to a filesystem path. */
export function resolveWorkspaceItemCwd(workspaceItemId: string): string | undefined {
  for (const ws of getWorkspaceCollection().toArray) {
    if (workspaceItemId === ws.id) return ws.path;

    const branchPrefix = `${ws.id}-branch-`;
    if (workspaceItemId.startsWith(branchPrefix)) return ws.path;

    const wtPrefix = `${ws.id}-wt-`;
    if (workspaceItemId.startsWith(wtPrefix)) {
      const wtName = workspaceItemId.slice(wtPrefix.length);
      const wt = ws.worktrees.find((w) => w.name === wtName);
      return wt?.path ?? ws.path;
    }
  }
  return undefined;
}

function storePaneCwd(paneId: string, workspaceItemId: string): void {
  const cwd = resolveWorkspaceItemCwd(workspaceItemId);
  if (cwd) setSetting(`cwd:${paneId}`, cwd);
}

function getNextTabIndex(): number {
  const usedNumbers = new Set(
    getTabCollection()
      .toArray.filter((t) => !t.labelIsManual)
      .map((t) => {
        const match = /^Terminal (\d+)$/.exec(t.label);
        return match ? parseInt(match[1]!, 10) : null;
      })
      .filter((n): n is number => n !== null),
  );
  let i = 1;
  while (usedNumbers.has(i)) i++;
  return i;
}

function makeTab(opts?: { workspaceItemId?: string; label?: string }): Tab {
  const id = crypto.randomUUID();
  const paneId = crypto.randomUUID();
  return {
    id,
    label: opts?.label ?? `Terminal ${getNextTabIndex()}`,
    labelIsManual: false,
    workspaceItemId: opts?.workspaceItemId ?? 'default',
    paneRoot: { type: 'leaf', id: paneId, ptyId: -1 },
    focusedPaneId: paneId,
    position: Math.max(-1, ...getTabCollection().toArray.map((t) => t.position)) + 1,
  };
}

export function renameTab(id: string, label: string, manual: boolean): void {
  const trimmed = label.trim().slice(0, 20);
  if (!trimmed) return;
  getTabCollection().update(id, (draft) => {
    draft.label = trimmed;
    draft.labelIsManual = manual;
  });
}

export function addTab(): void {
  const ui = getUiState();
  if (!ui.activeContextId) return;
  const tab = makeTab({ workspaceItemId: ui.activeContextId });
  storePaneCwd(tab.paneRoot.id, ui.activeContextId);
  getTabCollection().insert(tab);
  uiCollection.update('ui', (draft) => {
    draft.activeTabId = tab.id;
  });
}

export function closeTab(tabId: string): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  const contextId = tab.workspaceItemId;
  const contextTabs = col.toArray.filter((t) => t.workspaceItemId === contextId);

  if (contextTabs.length === 1) {
    col.delete(tabId);
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = '';
      const { [contextId]: _, ...rest } = draft.contextActiveTabIds;
      draft.contextActiveTabIds = rest;
    });
    return;
  }

  col.delete(tabId);

  const ui = getUiState();
  if (ui.activeTabId === tabId) {
    const remaining = col.toArray.filter((t) => t.workspaceItemId === contextId);
    const newTabId = remaining.length > 0 ? remaining[0]!.id : '';
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = newTabId;
    });
  }
}

export function switchTab(tabId: string): void {
  if (getTabCollection().toArray.some((t) => t.id === tabId)) {
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = tabId;
    });
  }
}

export function switchTabByIndex(index: number): void {
  const ui = getUiState();
  const contextTabs = getTabCollection().toArray.filter(
    (t) => t.workspaceItemId === ui.activeContextId,
  );
  if (index >= 0 && index < contextTabs.length) {
    const tabId = contextTabs[index]!.id;
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = tabId;
    });
  }
}

export function switchTabRelative(direction: 'prev' | 'next'): void {
  const ui = getUiState();
  const contextTabs = getTabCollection().toArray.filter(
    (t) => t.workspaceItemId === ui.activeContextId,
  );
  const idx = contextTabs.findIndex((t) => t.id === ui.activeTabId);
  if (idx === -1) return;
  const newIdx =
    direction === 'next'
      ? (idx + 1) % contextTabs.length
      : (idx - 1 + contextTabs.length) % contextTabs.length;
  const tabId = contextTabs[newIdx]!.id;
  uiCollection.update('ui', (draft) => {
    draft.activeTabId = tabId;
  });
}

export function setActiveContext(contextId: string): void {
  const ui = getUiState();
  const col = getTabCollection();

  const updatedContextActiveTabIds = {
    ...ui.contextActiveTabIds,
    [ui.activeContextId]: ui.activeTabId,
  };

  const contextTabs = col.toArray.filter((t) => t.workspaceItemId === contextId);

  if (contextTabs.length > 0) {
    const savedTabId = updatedContextActiveTabIds[contextId];
    const savedTab = savedTabId ? contextTabs.find((t) => t.id === savedTabId) : null;
    const newActiveTabId = savedTab ? savedTab.id : contextTabs[0]!.id;
    uiCollection.update('ui', (draft) => {
      draft.contextActiveTabIds = updatedContextActiveTabIds;
      draft.activeContextId = contextId;
      draft.activeTabId = newActiveTabId;
    });
  } else {
    uiCollection.update('ui', (draft) => {
      draft.contextActiveTabIds = updatedContextActiveTabIds;
      draft.activeContextId = contextId;
      draft.activeTabId = '';
    });
  }
}

export function getActiveTab(): Tab | undefined {
  const ui = getUiState();
  return getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
}

export function getContextTabs(): Tab[] {
  const ui = getUiState();
  return getTabCollection().toArray.filter((t) => t.workspaceItemId === ui.activeContextId);
}

export function splitPane(paneId: PaneId, direction: SplitDirection, newPtyId: number): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  const [newTree, newLeafId] = splitNode(tab.paneRoot, paneId, direction, newPtyId);
  storePaneCwd(newLeafId, tab.workspaceItemId);
  getTabCollection().update(tab.id, (draft) => {
    draft.paneRoot = newTree;
    draft.focusedPaneId = newLeafId;
  });
}

/** Close a pane in a specific tab (not necessarily the active one). */
export function closePaneInTab(tabId: string, paneId: PaneId): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  const result = removeNode(tab.paneRoot, paneId);
  col.update(tab.id, (draft) => {
    if (result === null) {
      const newId = crypto.randomUUID();
      draft.paneRoot = { type: 'leaf', id: newId, ptyId: -1 };
      draft.focusedPaneId = newId;
    } else {
      draft.paneRoot = result;
      if (draft.focusedPaneId === paneId) {
        const firstLeaf = findFirstLeaf(result);
        draft.focusedPaneId = firstLeaf?.id ?? null;
      }
    }
  });
}

export function closePane(paneId: PaneId): void {
  const tab = getTabCollection().toArray.find((t) => t.id === getUiState().activeTabId);
  if (!tab) return;
  closePaneInTab(tab.id, paneId);
}

/**
 * Mark a pane as killed (ptyId = -2). The pane stays in the tree but shows
 * a "session terminated" screen instead of spawning a new terminal.
 */
export function killPaneInTab(tabId: string, paneId: PaneId): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  col.update(tab.id, (draft) => {
    function markKilled(node: Tab['paneRoot']): void {
      if (node.type === 'leaf') {
        if (node.id === paneId) node.ptyId = -2;
        return;
      }
      for (const child of node.children) markKilled(child);
    }
    markKilled(draft.paneRoot);
  });
}

/**
 * Navigate to a specific workspace → tab → pane from anywhere in the app.
 *
 * - Same context: switchTab direct — no route change, no re-render.
 * - Cross context: pre-populates contextActiveTabIds before navigating so that
 *   setActiveContext (triggered by the route's useEffect) picks the right tab.
 * - Pane: focusedPaneId is set directly on the tab, independent of active context.
 *
 * Always calls navigate() to handle the case where the user is on a different
 * route (e.g. /settings) even when the workspace context is already correct.
 */
export function jumpToPane(
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
  workspaceItemId: string,
  tabId?: string,
  paneId?: string,
): void {
  const ui = getUiState();

  if (tabId && paneId) {
    getTabCollection().update(tabId, (draft) => {
      draft.focusedPaneId = paneId;
    });
  }

  if (ui.activeContextId !== workspaceItemId && tabId) {
    uiCollection.update('ui', (draft) => {
      draft.contextActiveTabIds[workspaceItemId] = tabId;
    });
  }

  navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: workspaceItemId } });

  if (ui.activeContextId === workspaceItemId && tabId) {
    switchTab(tabId);
  }
}

export function setFocus(paneId: PaneId): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  getTabCollection().update(tab.id, (draft) => {
    draft.focusedPaneId = paneId;
  });
}

export function navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab || !tab.focusedPaneId) return;
  const targetId = navFn(tab.paneRoot, tab.focusedPaneId, direction);
  if (targetId) {
    getTabCollection().update(tab.id, (draft) => {
      draft.focusedPaneId = targetId;
    });
  }
}

export function updateRatio(branchId: string, splitIndex: number, delta: number): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  const newRoot = updateRatioFn(tab.paneRoot, branchId, splitIndex, delta);
  getTabCollection().update(tab.id, (draft) => {
    draft.paneRoot = newRoot;
  });
}

/** Set ptyId in a specific tab (not necessarily the active one). Used for startup session restore. */
export function setPtyIdInTab(tabId: string, paneId: PaneId, ptyId: number): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  col.update(tab.id, (draft) => {
    function setInTree(node: Tab['paneRoot']): void {
      if (node.type === 'leaf') {
        if (node.id === paneId) node.ptyId = ptyId;
        return;
      }
      for (const child of node.children) setInTree(child);
    }
    setInTree(draft.paneRoot);
  });
}

export function setPtyId(paneId: PaneId, ptyId: number): void {
  const tab = getTabCollection().toArray.find((t) => t.id === getUiState().activeTabId);
  if (!tab) return;
  setPtyIdInTab(tab.id, paneId, ptyId);
}
