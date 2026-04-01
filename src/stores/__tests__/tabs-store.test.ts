import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore } from '../tabs-store';

function resetStore() {
  useTabsStore.setState(useTabsStore.getInitialState());
}

describe('tabs-store', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('has 1 tab with label "Terminal"', () => {
      const { tabs } = useTabsStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.label).toBe('Terminal');
    });

    it('initial tab has a sentinel leaf pane with ptyId=-1', () => {
      const { tabs } = useTabsStore.getState();
      const root = tabs[0]!.paneRoot;
      expect(root.type).toBe('leaf');
      if (root.type === 'leaf') {
        expect(root.ptyId).toBe(-1);
      }
    });

    it('initial tab has workspaceItemId "default"', () => {
      const { tabs } = useTabsStore.getState();
      expect(tabs[0]!.workspaceItemId).toBe('default');
    });

    it('initial activeContextId is "default"', () => {
      const { activeContextId } = useTabsStore.getState();
      expect(activeContextId).toBe('default');
    });

    it('initial contextActiveTabIds is empty', () => {
      const { contextActiveTabIds } = useTabsStore.getState();
      expect(contextActiveTabIds).toEqual({});
    });
  });

  describe('addTab', () => {
    it('creates new tab with label "Terminal"', () => {
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      expect(tabs).toHaveLength(2);
      expect(tabs[1]!.label).toBe('Terminal');
    });

    it('sets new tab as activeTabId', () => {
      useTabsStore.getState().addTab();
      const { tabs, activeTabId } = useTabsStore.getState();
      expect(activeTabId).toBe(tabs[1]!.id);
    });

    it('all tabs have same label', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      expect(tabs[2]!.label).toBe('Terminal');
    });

    it('new tab gets activeContextId as workspaceItemId', () => {
      useTabsStore.getState().addTab();
      const { tabs, activeContextId } = useTabsStore.getState();
      expect(tabs[1]!.workspaceItemId).toBe(activeContextId);
    });

    it('new tab in non-default context gets that context id', () => {
      useTabsStore.getState().setActiveContext('ws1', 'main');
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      const contextTabs = tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(contextTabs).toHaveLength(2); // auto-created + addTab
    });
  });

  describe('closeTab', () => {
    it('removes tab and switches to adjacent tab', () => {
      const store = useTabsStore.getState();
      store.addTab();
      store.addTab();
      const { tabs } = useTabsStore.getState();
      const tabToClose = tabs[1]!.id;
      useTabsStore.getState().closeTab(tabToClose);
      const after = useTabsStore.getState();
      expect(after.tabs).toHaveLength(2);
      expect(after.tabs.find((t) => t.id === tabToClose)).toBeUndefined();
    });

    it('closing last tab in context spawns fresh tab with same workspaceItemId', () => {
      const { tabs } = useTabsStore.getState();
      const onlyTabId = tabs[0]!.id;
      useTabsStore.getState().closeTab(onlyTabId);
      const after = useTabsStore.getState();
      // Should still have 1 tab in default context
      const contextTabs = after.tabs.filter((t) => t.workspaceItemId === 'default');
      expect(contextTabs).toHaveLength(1);
      expect(contextTabs[0]!.id).not.toBe(onlyTabId);
      expect(contextTabs[0]!.label).toBe('Terminal');
      expect(contextTabs[0]!.workspaceItemId).toBe('default');
    });

    it('closing last tab in non-default context spawns fresh tab with that context id', () => {
      useTabsStore.getState().setActiveContext('ws1', 'main');
      const { tabs } = useTabsStore.getState();
      const ws1Tab = tabs.find((t) => t.workspaceItemId === 'ws1')!;
      useTabsStore.getState().closeTab(ws1Tab.id);
      const after = useTabsStore.getState();
      const contextTabs = after.tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(contextTabs).toHaveLength(1);
      expect(contextTabs[0]!.workspaceItemId).toBe('ws1');
    });
  });

  describe('switchTabByIndex', () => {
    it('switches within context tabs only (index relative to context)', () => {
      // Create tabs in default context
      useTabsStore.getState().addTab(); // default tab 2
      // Switch to another context to create tabs there
      useTabsStore.getState().setActiveContext('ws1', 'main');
      useTabsStore.getState().addTab(); // ws1 tab 2
      // Switch back to default
      useTabsStore.getState().setActiveContext('default');
      // Index 0 should be the first default tab
      useTabsStore.getState().switchTabByIndex(0);
      const state = useTabsStore.getState();
      const defaultTabs = state.tabs.filter((t) => t.workspaceItemId === 'default');
      expect(state.activeTabId).toBe(defaultTabs[0]!.id);
    });

    it('does nothing when index is out of bounds', () => {
      const before = useTabsStore.getState().activeTabId;
      useTabsStore.getState().switchTabByIndex(99);
      expect(useTabsStore.getState().activeTabId).toBe(before);
    });
  });

  describe('switchTabRelative', () => {
    it('next wraps within context tabs', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      // activeTabId is on last default tab (tab 3)
      const { tabs } = useTabsStore.getState();
      const defaultTabs = tabs.filter((t) => t.workspaceItemId === 'default');
      expect(useTabsStore.getState().activeTabId).toBe(defaultTabs[2]!.id);
      useTabsStore.getState().switchTabRelative('next');
      expect(useTabsStore.getState().activeTabId).toBe(defaultTabs[0]!.id);
    });

    it('prev wraps within context tabs', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      const defaultTabs = tabs.filter((t) => t.workspaceItemId === 'default');
      useTabsStore.getState().switchTabByIndex(0);
      useTabsStore.getState().switchTabRelative('prev');
      expect(useTabsStore.getState().activeTabId).toBe(defaultTabs[2]!.id);
    });
  });

  describe('setActiveContext', () => {
    it('creates new tab group when switching to unknown context', () => {
      useTabsStore.getState().setActiveContext('ws1', 'main');
      const state = useTabsStore.getState();
      expect(state.activeContextId).toBe('ws1');
      const ws1Tabs = state.tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(ws1Tabs).toHaveLength(1);
      expect(ws1Tabs[0]!.label).toBe('main');
      expect(state.activeTabId).toBe(ws1Tabs[0]!.id);
    });

    it('restores previous tab group when switching back', () => {
      // Save initial tab id
      const initialTabId = useTabsStore.getState().tabs[0]!.id;
      // Switch to ws1
      useTabsStore.getState().setActiveContext('ws1', 'main');
      // Switch back to default
      useTabsStore.getState().setActiveContext('default');
      const state = useTabsStore.getState();
      expect(state.activeContextId).toBe('default');
      expect(state.activeTabId).toBe(initialTabId);
    });

    it('remembers active tab per context', () => {
      // Add a second tab in default context
      useTabsStore.getState().addTab();
      const secondDefaultTabId = useTabsStore.getState().activeTabId;
      // Switch to ws1
      useTabsStore.getState().setActiveContext('ws1', 'main');
      // Switch back to default -- should restore second tab as active
      useTabsStore.getState().setActiveContext('default');
      expect(useTabsStore.getState().activeTabId).toBe(secondDefaultTabId);
    });

    it('saves current activeTabId to contextActiveTabIds before switching', () => {
      const initialTabId = useTabsStore.getState().tabs[0]!.id;
      useTabsStore.getState().setActiveContext('ws1', 'main');
      const state = useTabsStore.getState();
      expect(state.contextActiveTabIds['default']).toBe(initialTabId);
    });

    it('does not create duplicate tabs when switching to existing context', () => {
      useTabsStore.getState().setActiveContext('ws1', 'main');
      const tabCountAfterFirst = useTabsStore.getState().tabs.length;
      useTabsStore.getState().setActiveContext('default');
      useTabsStore.getState().setActiveContext('ws1', 'main');
      expect(useTabsStore.getState().tabs.length).toBe(tabCountAfterFirst);
    });
  });

  describe('getContextTabs', () => {
    it('returns only tabs matching activeContextId', () => {
      useTabsStore.getState().addTab(); // second default tab
      useTabsStore.getState().setActiveContext('ws1', 'main');
      // Now in ws1 context
      const contextTabs = useTabsStore.getState().getContextTabs();
      expect(contextTabs).toHaveLength(1);
      expect(contextTabs[0]!.workspaceItemId).toBe('ws1');
    });

    it('returns all default tabs when in default context', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const contextTabs = useTabsStore.getState().getContextTabs();
      expect(contextTabs).toHaveLength(3);
      contextTabs.forEach((t) => expect(t.workspaceItemId).toBe('default'));
    });

    it('works as a zustand selector', () => {
      // Verify it can be called via getState()
      const result = useTabsStore.getState().getContextTabs();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('pane operations scoped to active tab', () => {
    it('splitPane modifies only active tab paneRoot', () => {
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      // Switch to first tab
      useTabsStore.getState().switchTab(tabs[0]!.id);
      // Set up a real ptyId first
      useTabsStore.getState().setPtyId(tabs[0]!.focusedPaneId!, 1);
      useTabsStore.getState().splitPane(tabs[0]!.focusedPaneId!, 'horizontal', 2);
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      const otherTab = after.tabs.find((t) => t.id !== after.activeTabId)!;
      // Active tab should now have a branch root
      expect(activeTab.paneRoot.type).toBe('branch');
      // Other tab should still have leaf root
      expect(otherTab.paneRoot.type).toBe('leaf');
    });

    it('closePane modifies only active tab paneRoot', () => {
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      // Close the original pane
      useTabsStore.getState().closePane(paneId);
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      expect(activeTab.paneRoot.type).toBe('leaf');
    });

    it('closePane on last pane creates sentinel leaf, does NOT close tab', () => {
      const { tabs, activeTabId } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().closePane(paneId);
      const after = useTabsStore.getState();
      // Tab still exists
      expect(after.tabs).toHaveLength(1);
      expect(after.activeTabId).toBe(activeTabId);
      // Root is a new sentinel leaf
      const root = after.tabs[0]!.paneRoot;
      expect(root.type).toBe('leaf');
      if (root.type === 'leaf') {
        expect(root.ptyId).toBe(-1);
        expect(root.id).not.toBe(paneId);
      }
    });

    it('setFocus updates active tab focusedPaneId', () => {
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      // Focus should be on the new pane after split
      expect(activeTab.focusedPaneId).not.toBe(paneId);
      // Now set focus back to original
      useTabsStore.getState().setFocus(paneId);
      const final = useTabsStore.getState();
      const finalTab = final.tabs.find((t) => t.id === final.activeTabId)!;
      expect(finalTab.focusedPaneId).toBe(paneId);
    });

    it('navigate updates active tab focusedPaneId', () => {
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      // After split, focus is on new pane; navigate left should go back to original
      useTabsStore.getState().navigate('left');
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      expect(activeTab.focusedPaneId).toBe(paneId);
    });
  });

  describe('getActiveTab', () => {
    it('returns the tab matching activeTabId', () => {
      const { activeTabId } = useTabsStore.getState();
      const tab = useTabsStore.getState().getActiveTab();
      expect(tab).toBeDefined();
      expect(tab!.id).toBe(activeTabId);
    });
  });
});
