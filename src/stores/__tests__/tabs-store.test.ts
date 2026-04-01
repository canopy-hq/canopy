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

    it('on last tab spawns fresh "Terminal N+1" tab', () => {
      const { tabs } = useTabsStore.getState();
      const onlyTabId = tabs[0]!.id;
      useTabsStore.getState().closeTab(onlyTabId);
      const after = useTabsStore.getState();
      expect(after.tabs).toHaveLength(1);
      expect(after.tabs[0]!.id).not.toBe(onlyTabId);
      expect(after.tabs[0]!.label).toBe('Terminal');
    });
  });

  describe('switchTabByIndex', () => {
    it('sets first tab active when index=0', () => {
      useTabsStore.getState().addTab();
      const firstTabId = useTabsStore.getState().tabs[0]!.id;
      useTabsStore.getState().switchTabByIndex(0);
      expect(useTabsStore.getState().activeTabId).toBe(firstTabId);
    });

    it('does nothing when index is out of bounds', () => {
      const before = useTabsStore.getState().activeTabId;
      useTabsStore.getState().switchTabByIndex(99);
      expect(useTabsStore.getState().activeTabId).toBe(before);
    });
  });

  describe('switchTabRelative', () => {
    it('next wraps from last to first', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      // activeTabId is on last tab (tab 3)
      const { tabs } = useTabsStore.getState();
      expect(useTabsStore.getState().activeTabId).toBe(tabs[2]!.id);
      useTabsStore.getState().switchTabRelative('next');
      expect(useTabsStore.getState().activeTabId).toBe(tabs[0]!.id);
    });

    it('prev wraps from first to last', () => {
      useTabsStore.getState().addTab();
      useTabsStore.getState().addTab();
      const { tabs } = useTabsStore.getState();
      useTabsStore.getState().switchTabByIndex(0);
      useTabsStore.getState().switchTabRelative('prev');
      expect(useTabsStore.getState().activeTabId).toBe(tabs[2]!.id);
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
