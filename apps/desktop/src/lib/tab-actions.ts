import { getTabCollection, uiCollection, getUiState, setSetting } from '@superagent/db';
import type { Tab } from '@superagent/db';
import {
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate as navFn,
  updateRatio as updateRatioFn,
  type PaneId,
  type SplitDirection,
} from './pane-tree-ops';

function makeTab(opts?: { workspaceItemId?: string; label?: string }): Tab {
  const id = crypto.randomUUID();
  const paneId = crypto.randomUUID();
  return {
    id,
    label: opts?.label ?? 'Terminal',
    workspaceItemId: opts?.workspaceItemId ?? 'default',
    paneRoot: { type: 'leaf', id: paneId, ptyId: -1 },
    focusedPaneId: paneId,
    position: getTabCollection().toArray.length,
  };
}

export function addTab(): void {
  const ui = getUiState();
  if (!ui.activeContextId) return;
  const tab = makeTab({ workspaceItemId: ui.activeContextId });
  getTabCollection().insert(tab);
  uiCollection.update('ui', (draft) => {
    draft.activeTabId = tab.id;
  });
  setSetting('activeTabId', tab.id);
}

export function closeTab(tabId: string): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  const contextId = tab.workspaceItemId;
  const contextTabs = col.toArray.filter((t) => t.workspaceItemId === contextId);

  if (contextTabs.length === 1) {
    const fresh = makeTab({ workspaceItemId: contextId });
    col.insert(fresh);
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = fresh.id;
    });
  }

  col.delete(tabId);

  const ui = getUiState();
  if (ui.activeTabId === tabId) {
    const remaining = col.toArray.filter((t) => t.workspaceItemId === contextId);
    const newTabId = remaining.length > 0 ? remaining[0]!.id : (col.toArray[0]?.id ?? '');
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = newTabId;
    });
    setSetting('activeTabId', newTabId);
  }
}

export function switchTab(tabId: string): void {
  if (getTabCollection().toArray.some((t) => t.id === tabId)) {
    uiCollection.update('ui', (draft) => {
      draft.activeTabId = tabId;
    });
    setSetting('activeTabId', tabId);
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
    setSetting('activeTabId', tabId);
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
  setSetting('activeTabId', tabId);
}

export function setActiveContext(contextId: string, label?: string): void {
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
    setSetting('activeContextId', contextId);
    setSetting('activeTabId', newActiveTabId);
  } else {
    const tab = makeTab({ workspaceItemId: contextId, label: label ?? 'Terminal' });
    col.insert(tab);
    uiCollection.update('ui', (draft) => {
      draft.contextActiveTabIds = { ...updatedContextActiveTabIds, [contextId]: tab.id };
      draft.activeContextId = contextId;
      draft.activeTabId = tab.id;
    });
    setSetting('activeContextId', contextId);
    setSetting('activeTabId', tab.id);
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
  getTabCollection().update(tab.id, (draft) => {
    draft.paneRoot = newTree;
    draft.focusedPaneId = newLeafId;
  });
}

export function closePane(paneId: PaneId): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  const result = removeNode(tab.paneRoot, paneId);
  getTabCollection().update(tab.id, (draft) => {
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

export function setPtyId(paneId: PaneId, ptyId: number): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  getTabCollection().update(tab.id, (draft) => {
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
