import { useCallback, useEffect, useMemo } from 'react';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { PaneContainer } from './components/PaneContainer';
import { ErrorToastRegion } from './components/ToastProvider';
import { useKeyboardRegistry, type Keybinding } from './hooks/useKeyboardRegistry';
import { useTabsStore } from './stores/tabs-store';
import { useThemeStore } from './stores/theme-store';
import { useWorkspaceStore } from './stores/workspace-store';
import { closePty } from './lib/pty';
import { disposeCached } from './lib/terminal-cache';
import { findLeaf } from './lib/pane-tree-ops';
import { showErrorToast } from './lib/toast';

export default function App() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const addTab = useTabsStore((s) => s.addTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const splitPane = useTabsStore((s) => s.splitPane);
  const closePane = useTabsStore((s) => s.closePane);
  const navigatePanes = useTabsStore((s) => s.navigate);
  const switchTabByIndex = useTabsStore((s) => s.switchTabByIndex);
  const switchTabRelative = useTabsStore((s) => s.switchTabRelative);
  const initTheme = useThemeStore((s) => s.initTheme);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  // Initialize theme from persisted settings on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // Split handler: reads focusedPaneId from getState() to avoid stale closure
  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      const store = useTabsStore.getState();
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
      if (!activeTab?.focusedPaneId) return;
      try {
        splitPane(activeTab.focusedPaneId, direction, -1);
      } catch (err) {
        showErrorToast('Failed to split pane', String(err));
      }
    },
    [splitPane],
  );

  // Close handler: Cmd+W behavior
  // Single pane in tab -> close tab (D-07 ensures fresh tab spawns)
  // Multiple panes -> close focused pane
  const handleClose = useCallback(async () => {
    const store = useTabsStore.getState();
    const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
    if (!activeTab?.focusedPaneId) return;

    if (activeTab.paneRoot.type === 'leaf') {
      // Close the entire tab
      const leaf = activeTab.paneRoot;
      if (leaf.ptyId > 0) {
        disposeCached(leaf.ptyId);
        try {
          await closePty(leaf.ptyId);
        } catch {
          /* PTY may be dead */
        }
      }
      closeTab(activeTab.id);
    } else {
      // Close focused pane within tab
      const leaf = findLeaf(activeTab.paneRoot, activeTab.focusedPaneId);
      if (leaf && leaf.ptyId > 0) {
        disposeCached(leaf.ptyId);
        try {
          await closePty(leaf.ptyId);
        } catch {
          /* PTY may be dead */
        }
      }
      closePane(activeTab.focusedPaneId);
    }
  }, [closeTab, closePane]);

  // Keyboard shortcuts
  const bindings: Keybinding[] = useMemo(
    () => [
      // Pane shortcuts (existing)
      { key: 'd', meta: true, action: () => handleSplit('horizontal') },
      { key: 'd', meta: true, shift: true, action: () => handleSplit('vertical') },
      { key: 'w', meta: true, action: () => handleClose() },
      { key: 'ArrowLeft', meta: true, alt: true, action: () => navigatePanes('left') },
      { key: 'ArrowRight', meta: true, alt: true, action: () => navigatePanes('right') },
      { key: 'ArrowUp', meta: true, alt: true, action: () => navigatePanes('up') },
      { key: 'ArrowDown', meta: true, alt: true, action: () => navigatePanes('down') },
      // Tab shortcuts (TABS-01, TABS-02)
      { key: 't', meta: true, action: () => addTab() },
      // Cmd+1 through Cmd+9
      ...Array.from({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        meta: true,
        action: () => switchTabByIndex(i),
      })),
      // Cmd+Shift+[ and Cmd+Shift+]
      { key: '[', meta: true, shift: true, action: () => switchTabRelative('prev') },
      { key: ']', meta: true, shift: true, action: () => switchTabRelative('next') },
      // Sidebar toggle (SIDE-01)
      { key: 'b', meta: true, action: () => toggleSidebar() },
    ],
    [handleSplit, handleClose, navigatePanes, addTab, switchTabByIndex, switchTabRelative, toggleSidebar],
  );

  useKeyboardRegistry(bindings);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-primary">
      <TabBar />
      <div className="flex-1 min-h-0 flex flex-row">
        <Sidebar />
        <div className="flex-1 min-w-0 relative">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
            >
              <PaneContainer root={tab.paneRoot} />
            </div>
          ))}
        </div>
      </div>
      <StatusBar />
      <ErrorToastRegion />
    </div>
  );
}
