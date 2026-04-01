import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate as navFn,
  updateRatio,
  findLeaf,
  type PaneNode,
  type PaneId,
  type SplitDirection,
} from '../lib/pane-tree-ops';

export interface Tab {
  id: string;
  label: string;
  workspaceItemId?: string;
  paneRoot: PaneNode;
  focusedPaneId: PaneId | null;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  // Tab operations
  addTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  switchTabByIndex: (index: number) => void;
  switchTabRelative: (direction: 'prev' | 'next') => void;
  getActiveTab: () => Tab | undefined;

  // Workspace-tab association
  findOrCreateTabForWorkspaceItem: (itemId: string, label: string) => void;

  // Pane operations (scoped to active tab)
  splitPane: (paneId: PaneId, direction: SplitDirection, newPtyId: number) => void;
  closePane: (paneId: PaneId) => void;
  setFocus: (paneId: PaneId) => void;
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void;
  updateRatio: (branchId: string, splitIndex: number, delta: number) => void;
  setPtyId: (paneId: PaneId, ptyId: number) => void;
}

function makeTab(opts?: { workspaceItemId?: string; label?: string }): Tab {
  const id = crypto.randomUUID();
  const paneId = crypto.randomUUID();
  return {
    id,
    label: opts?.label ?? 'Terminal',
    workspaceItemId: opts?.workspaceItemId,
    paneRoot: { type: 'leaf', id: paneId, ptyId: -1 },
    focusedPaneId: paneId,
  };
}

const initialTab = makeTab();

export const useTabsStore = create<TabsState>()(
  immer((set, get) => ({
    tabs: [initialTab],
    activeTabId: initialTab.id,
    addTab: () =>
      set((state) => {
        const tab = makeTab();
        state.tabs.push(tab);
        state.activeTabId = tab.id;
      }),

    closeTab: (tabId) =>
      set((state) => {
        if (state.tabs.length === 1) {
          // Never zero tabs -- spawn fresh one first (D-07)
          const fresh = makeTab();
          state.tabs.push(fresh);
          state.activeTabId = fresh.id;
        }
        const idx = state.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;
        state.tabs.splice(idx, 1);
        // If we closed the active tab, pick adjacent
        if (state.activeTabId === tabId) {
          const newIdx = Math.min(idx, state.tabs.length - 1);
          state.activeTabId = state.tabs[newIdx]!.id;
        }
      }),

    switchTab: (tabId) =>
      set((state) => {
        if (state.tabs.some((t) => t.id === tabId)) {
          state.activeTabId = tabId;
        }
      }),

    switchTabByIndex: (index) =>
      set((state) => {
        if (index >= 0 && index < state.tabs.length) {
          state.activeTabId = state.tabs[index]!.id;
        }
      }),

    switchTabRelative: (direction) =>
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
        if (idx === -1) return;
        let newIdx: number;
        if (direction === 'next') {
          newIdx = (idx + 1) % state.tabs.length;
        } else {
          newIdx = (idx - 1 + state.tabs.length) % state.tabs.length;
        }
        state.activeTabId = state.tabs[newIdx]!.id;
      }),

    getActiveTab: () => {
      const { tabs, activeTabId } = get();
      return tabs.find((t) => t.id === activeTabId);
    },

    findOrCreateTabForWorkspaceItem: (itemId, label) =>
      set((state) => {
        const existing = state.tabs.find((t) => t.workspaceItemId === itemId);
        if (existing) {
          state.activeTabId = existing.id;
          return;
        }
        const tab = makeTab({ workspaceItemId: itemId, label });
        state.tabs.push(tab);
        state.activeTabId = tab.id;
      }),

    // ── Pane operations (scoped to active tab) ──────────────────────

    splitPane: (paneId, direction, newPtyId) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        const [newTree, newLeafId] = splitNode(tab.paneRoot, paneId, direction, newPtyId);
        tab.paneRoot = newTree;
        tab.focusedPaneId = newLeafId;
      }),

    closePane: (paneId) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        const result = removeNode(tab.paneRoot, paneId);
        if (result === null) {
          // Last pane closed -- reset to sentinel leaf with ptyId=-1
          const newId = crypto.randomUUID();
          tab.paneRoot = { type: 'leaf', id: newId, ptyId: -1 };
          tab.focusedPaneId = newId;
          return;
        }
        tab.paneRoot = result;
        if (tab.focusedPaneId === paneId) {
          const firstLeaf = findFirstLeaf(result);
          tab.focusedPaneId = firstLeaf?.id ?? null;
        }
      }),

    setFocus: (paneId) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        tab.focusedPaneId = paneId;
      }),

    navigate: (direction) => {
      const { tabs, activeTabId } = get();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || !tab.focusedPaneId) return;
      const targetId = navFn(tab.paneRoot, tab.focusedPaneId, direction);
      if (targetId) set((state) => {
        const t = state.tabs.find((t) => t.id === state.activeTabId);
        if (t) t.focusedPaneId = targetId;
      });
    },

    updateRatio: (branchId, splitIndex, delta) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        tab.paneRoot = updateRatio(tab.paneRoot, branchId, splitIndex, delta);
      }),

    setPtyId: (paneId, ptyId) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        const setInTree = (node: PaneNode): void => {
          if (node.type === 'leaf') {
            if (node.id === paneId) node.ptyId = ptyId;
            return;
          }
          for (const child of node.children) setInTree(child);
        };
        setInTree(tab.paneRoot);
      }),
  })),
);
