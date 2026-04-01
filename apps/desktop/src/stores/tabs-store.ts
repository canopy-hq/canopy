import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate as navFn,
  updateRatio,
  type PaneNode,
  type PaneId,
  type SplitDirection,
} from '../lib/pane-tree-ops';

export interface Tab {
  id: string;
  label: string;
  workspaceItemId: string;
  paneRoot: PaneNode;
  focusedPaneId: PaneId | null;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  activeContextId: string;
  contextActiveTabIds: Record<string, string>;

  // Tab operations
  addTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  switchTabByIndex: (index: number) => void;
  switchTabRelative: (direction: 'prev' | 'next') => void;
  getActiveTab: () => Tab | undefined;
  getContextTabs: () => Tab[];

  // Context switching
  setActiveContext: (contextId: string, label?: string) => void;

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
    workspaceItemId: opts?.workspaceItemId ?? 'default',
    paneRoot: { type: 'leaf', id: paneId, ptyId: -1 },
    focusedPaneId: paneId,
  };
}

export const useTabsStore = create<TabsState>()(
  immer((set, get) => ({
    tabs: [],
    activeTabId: '',
    activeContextId: '',
    contextActiveTabIds: {},

    addTab: () =>
      set((state) => {
        if (!state.activeContextId) return;
        const tab = makeTab({ workspaceItemId: state.activeContextId });
        state.tabs.push(tab);
        state.activeTabId = tab.id;
      }),

    closeTab: (tabId) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        const contextId = tab.workspaceItemId;
        const contextTabs = state.tabs.filter((t) => t.workspaceItemId === contextId);

        if (contextTabs.length === 1) {
          // Last tab in this context -- spawn fresh one with same context
          const fresh = makeTab({ workspaceItemId: contextId });
          state.tabs.push(fresh);
          state.activeTabId = fresh.id;
        }

        const idx = state.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;
        state.tabs.splice(idx, 1);

        // If we closed the active tab, pick adjacent within context
        if (state.activeTabId === tabId) {
          const remaining = state.tabs.filter((t) => t.workspaceItemId === contextId);
          if (remaining.length > 0) {
            state.activeTabId = remaining[0]!.id;
          } else {
            // Fallback to any tab
            state.activeTabId = state.tabs[0]!.id;
          }
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
        const contextTabs = state.tabs.filter(
          (t) => t.workspaceItemId === state.activeContextId,
        );
        if (index >= 0 && index < contextTabs.length) {
          state.activeTabId = contextTabs[index]!.id;
        }
      }),

    switchTabRelative: (direction) =>
      set((state) => {
        const contextTabs = state.tabs.filter(
          (t) => t.workspaceItemId === state.activeContextId,
        );
        const idx = contextTabs.findIndex((t) => t.id === state.activeTabId);
        if (idx === -1) return;
        let newIdx: number;
        if (direction === 'next') {
          newIdx = (idx + 1) % contextTabs.length;
        } else {
          newIdx = (idx - 1 + contextTabs.length) % contextTabs.length;
        }
        state.activeTabId = contextTabs[newIdx]!.id;
      }),

    getActiveTab: () => {
      const { tabs, activeTabId } = get();
      return tabs.find((t) => t.id === activeTabId);
    },

    getContextTabs: () => {
      const { tabs, activeContextId } = get();
      return tabs.filter((t) => t.workspaceItemId === activeContextId);
    },

    setActiveContext: (contextId, label) =>
      set((state) => {
        // Save current activeTabId for current context
        state.contextActiveTabIds[state.activeContextId] = state.activeTabId;

        // Switch context
        state.activeContextId = contextId;

        // Check if any tabs exist for this context
        const contextTabs = state.tabs.filter((t) => t.workspaceItemId === contextId);

        if (contextTabs.length > 0) {
          // Restore saved active tab, or first matching tab
          const savedTabId = state.contextActiveTabIds[contextId];
          const savedTab = savedTabId
            ? contextTabs.find((t) => t.id === savedTabId)
            : null;
          state.activeTabId = savedTab ? savedTab.id : contextTabs[0]!.id;
        } else {
          // Create new tab for this context
          const tab = makeTab({ workspaceItemId: contextId, label: label ?? 'Terminal' });
          state.tabs.push(tab);
          state.activeTabId = tab.id;
          state.contextActiveTabIds[contextId] = tab.id;
        }
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
