import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore } from '../tabs-store';

function resetStore() {
  useTabsStore.setState(useTabsStore.getInitialState());
}

/** Helper: set up a context with one tab so tests that need tabs can start from a known state */
function setupContext(contextId = 'ws1', label = 'main') {
  useTabsStore.getState().setActiveContext(contextId, label);
}

describe('tabs-store', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with no tabs', () => {
      const { tabs } = useTabsStore.getState();
      expect(tabs).toHaveLength(0);
    });

    it('starts with empty activeContextId', () => {
      const { activeContextId } = useTabsStore.getState();
      expect(activeContextId).toBe('');
    });

    it('starts with empty activeTabId', () => {
      const { activeTabId } = useTabsStore.getState();
      expect(activeTabId).toBe('');
    });

    it('initial contextActiveTabIds is empty', () => {
      const { contextActiveTabIds } = useTabsStore.getState();
      expect(contextActiveTabIds).toEqual({});
    });
  });

  describe('addTab', () => {
    it('does nothing when no context is active', () => {
      useTabsStore.getState().addTab();
      expect(useTabsStore.getState().tabs).toHaveLength(0);
    });

    it('creates new tab within active context', () => {
      setupContext();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      expect(tabs).toHaveLength(2); // setActiveContext created 1 + addTab created 1
      expect(tabs[1]!.label).toBe('Terminal');
      expect(tabs[1]!.workspaceItemId).toBe('ws1');
    });

    it('sets new tab as activeTabId', () => {
      setupContext();
      useTabsStore.getState().addTab();
      const { tabs, activeTabId } = useTabsStore.getState();
      expect(activeTabId).toBe(tabs[1]!.id);
    });
  });

  describe('closeTab', () => {
    it('removes tab and switches to adjacent tab', () => {
      setupContext();
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      const tabToClose = tabs[1]!.id;
      useTabsStore.getState().closeTab(tabToClose);
      const after = useTabsStore.getState();
      expect(after.tabs).toHaveLength(2);
      expect(after.tabs.find((t) => t.id === tabToClose)).toBeUndefined();
    });

    it('closing last tab in context spawns fresh tab with same workspaceItemId', () => {
      setupContext();
      const { tabs } = useTabsStore.getState();
      const onlyTabId = tabs[0]!.id;
      useTabsStore.getState().closeTab(onlyTabId);
      const after = useTabsStore.getState();
      const contextTabs = after.tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(contextTabs).toHaveLength(1);
      expect(contextTabs[0]!.id).not.toBe(onlyTabId);
      expect(contextTabs[0]!.workspaceItemId).toBe('ws1');
    });
  });

  describe('switchTabByIndex', () => {
    it('switches within context tabs only', () => {
      setupContext('ws1', 'main');
      useTabsStore.getState().addTab();
      useTabsStore.getState().setActiveContext('ws2', 'dev');
      useTabsStore.getState().addTab();
      // Switch back to ws1
      useTabsStore.getState().setActiveContext('ws1');
      useTabsStore.getState().switchTabByIndex(0);
      const state = useTabsStore.getState();
      const ws1Tabs = state.tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(state.activeTabId).toBe(ws1Tabs[0]!.id);
    });

    it('does nothing when index is out of bounds', () => {
      setupContext();
      const before = useTabsStore.getState().activeTabId;
      useTabsStore.getState().switchTabByIndex(99);
      expect(useTabsStore.getState().activeTabId).toBe(before);
    });
  });

  describe('switchTabRelative', () => {
    it('next wraps within context tabs', () => {
      setupContext();
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const contextTabs = useTabsStore.getState().tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(useTabsStore.getState().activeTabId).toBe(contextTabs[2]!.id);
      useTabsStore.getState().switchTabRelative('next');
      expect(useTabsStore.getState().activeTabId).toBe(contextTabs[0]!.id);
    });

    it('prev wraps within context tabs', () => {
      setupContext();
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const contextTabs = useTabsStore.getState().tabs.filter((t) => t.workspaceItemId === 'ws1');
      useTabsStore.getState().switchTabByIndex(0);
      useTabsStore.getState().switchTabRelative('prev');
      expect(useTabsStore.getState().activeTabId).toBe(contextTabs[2]!.id);
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
      setupContext('ws1', 'main');
      const ws1TabId = useTabsStore.getState().activeTabId;
      useTabsStore.getState().setActiveContext('ws2', 'dev');
      useTabsStore.getState().setActiveContext('ws1');
      expect(useTabsStore.getState().activeTabId).toBe(ws1TabId);
    });

    it('remembers active tab per context', () => {
      setupContext('ws1', 'main');
      useTabsStore.getState().addTab();
      const secondTabId = useTabsStore.getState().activeTabId;
      useTabsStore.getState().setActiveContext('ws2', 'dev');
      useTabsStore.getState().setActiveContext('ws1');
      expect(useTabsStore.getState().activeTabId).toBe(secondTabId);
    });

    it('does not create duplicate tabs when switching to existing context', () => {
      setupContext('ws1', 'main');
      const tabCountAfterFirst = useTabsStore.getState().tabs.length;
      useTabsStore.getState().setActiveContext('ws2', 'dev');
      useTabsStore.getState().setActiveContext('ws1', 'main');
      // Should not have grown beyond ws1 + ws2
      const ws1Tabs = useTabsStore.getState().tabs.filter((t) => t.workspaceItemId === 'ws1');
      expect(ws1Tabs).toHaveLength(1);
    });

    it('switching to empty context clears activeContextId', () => {
      setupContext();
      useTabsStore.getState().setActiveContext('');
      expect(useTabsStore.getState().activeContextId).toBe('');
    });
  });

  describe('getContextTabs', () => {
    it('returns only tabs matching activeContextId', () => {
      setupContext('ws1', 'main');
      useTabsStore.getState().addTab();
      useTabsStore.getState().setActiveContext('ws2', 'dev');
      const contextTabs = useTabsStore.getState().getContextTabs();
      expect(contextTabs).toHaveLength(1);
      expect(contextTabs[0]!.workspaceItemId).toBe('ws2');
    });

    it('returns empty array when no context is active', () => {
      const contextTabs = useTabsStore.getState().getContextTabs();
      expect(contextTabs).toHaveLength(0);
    });
  });

  describe('pane operations scoped to active tab', () => {
    it('splitPane modifies only active tab paneRoot', () => {
      setupContext();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      useTabsStore.getState().switchTab(tabs[0]!.id);
      useTabsStore.getState().setPtyId(tabs[0]!.focusedPaneId!, 1);
      useTabsStore.getState().splitPane(tabs[0]!.focusedPaneId!, 'horizontal', 2);
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      const otherTab = after.tabs.find((t) => t.id !== after.activeTabId)!;
      expect(activeTab.paneRoot.type).toBe('branch');
      expect(otherTab.paneRoot.type).toBe('leaf');
    });

    it('closePane modifies only active tab paneRoot', () => {
      setupContext();
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      useTabsStore.getState().closePane(paneId);
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      expect(activeTab.paneRoot.type).toBe('leaf');
    });

    it('closePane on last pane creates sentinel leaf, does NOT close tab', () => {
      setupContext();
      const { tabs, activeTabId } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().closePane(paneId);
      const after = useTabsStore.getState();
      expect(after.tabs).toHaveLength(1);
      expect(after.activeTabId).toBe(activeTabId);
      const root = after.tabs[0]!.paneRoot;
      expect(root.type).toBe('leaf');
      if (root.type === 'leaf') {
        expect(root.ptyId).toBe(-1);
        expect(root.id).not.toBe(paneId);
      }
    });

    it('setFocus updates active tab focusedPaneId', () => {
      setupContext();
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      useTabsStore.getState().setFocus(paneId);
      const final = useTabsStore.getState();
      const finalTab = final.tabs.find((t) => t.id === final.activeTabId)!;
      expect(finalTab.focusedPaneId).toBe(paneId);
    });

    it('navigate updates active tab focusedPaneId', () => {
      setupContext();
      const { tabs } = useTabsStore.getState();
      const paneId = tabs[0]!.focusedPaneId!;
      useTabsStore.getState().setPtyId(paneId, 1);
      useTabsStore.getState().splitPane(paneId, 'horizontal', 2);
      useTabsStore.getState().navigate('left');
      const after = useTabsStore.getState();
      const activeTab = after.tabs.find((t) => t.id === after.activeTabId)!;
      expect(activeTab.focusedPaneId).toBe(paneId);
    });
  });

  describe('getActiveTab', () => {
    it('returns undefined when no tabs exist', () => {
      const tab = useTabsStore.getState().getActiveTab();
      expect(tab).toBeUndefined();
    });

    it('returns the tab matching activeTabId', () => {
      setupContext();
      const { activeTabId } = useTabsStore.getState();
      const tab = useTabsStore.getState().getActiveTab();
      expect(tab).toBeDefined();
      expect(tab!.id).toBe(activeTabId);
    });
  });
});
