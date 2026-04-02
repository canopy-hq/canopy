import { useCallback, useEffect, useMemo, useState } from 'react';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { PaneContainer } from './components/PaneContainer';
import { ErrorToastRegion } from './components/ToastProvider';
import { AgentOverlay } from './components/AgentOverlay';
import { AgentToastRegion } from './components/AgentToastRegion';
import { useKeyboardRegistry, type Keybinding } from './hooks/useKeyboardRegistry';
import { useTabsStore } from './stores/tabs-store';
import { useThemeStore } from './stores/theme-store';
import { useWorkspaceStore } from './stores/workspace-store';
import { useAgentStore, initAgentListener } from './stores/agent-store';
import { closePty } from './lib/pty';
import { disposeCached } from './lib/terminal-cache';
import { findLeaf } from './lib/pane-tree-ops';
import type { PaneNode } from './lib/pane-tree-ops';
import { showErrorToast, showAgentToastDeduped } from './lib/toast';

/** Recursively check if a pane tree contains a leaf with the given ptyId */
function containsPtyId(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((child) => containsPtyId(child, ptyId));
}

export default function App() {
  const activeTab = useTabsStore((s) => s.getActiveTab());
  const addTab = useTabsStore((s) => s.addTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const splitPane = useTabsStore((s) => s.splitPane);
  const closePane = useTabsStore((s) => s.closePane);
  const navigatePanes = useTabsStore((s) => s.navigate);
  const switchTabByIndex = useTabsStore((s) => s.switchTabByIndex);
  const switchTabRelative = useTabsStore((s) => s.switchTabRelative);
  const initTheme = useThemeStore((s) => s.initTheme);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  const [overlayOpen, setOverlayOpen] = useState(false);

  // Initialize theme on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // Initialize agent event listener on mount
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    initAgentListener().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Subscribe to agent store changes for non-active workspace toasts
  useEffect(() => {
    const unsub = useAgentStore.subscribe((state, prevState) => {
      for (const ptyIdStr in state.agents) {
        const ptyId = Number(ptyIdStr);
        const agent = state.agents[ptyId];
        const prev = prevState.agents[ptyId];
        if (!agent || agent.status === prev?.status) continue;

        // Only toast for non-active workspace
        const tabs = useTabsStore.getState().tabs;
        const activeTabId = useTabsStore.getState().activeTabId;
        const agentTab = tabs.find((t) => containsPtyId(t.paneRoot, ptyId));
        if (!agentTab || agentTab.id === activeTabId) continue;

        // Find workspace info for toast
        const workspaces = useWorkspaceStore.getState().workspaces;
        const ws = workspaces.find((w) =>
          agentTab.workspaceItemId.startsWith(w.id),
        );

        if (agent.status === 'waiting') {
          showAgentToastDeduped({
            type: 'agent-waiting',
            agentName: agent.agentName,
            workspace: ws?.name ?? 'Unknown',
            branch: agentTab.label,
            ptyId,
          });
        } else if (agent.status === 'idle' && prev?.status === 'running') {
          showAgentToastDeduped({
            type: 'agent-complete',
            agentName: prev.agentName,
            workspace: ws?.name ?? 'Unknown',
            branch: agentTab.label,
            ptyId,
          });
        }
      }
    });
    return unsub;
  }, []);

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
      // Agent overlay toggle (AGNT-05, D-13)
      { key: 'o', meta: true, shift: true, action: () => setOverlayOpen((prev) => !prev) },
      // Agent manual toggle (AGNT-04, D-25)
      {
        key: 'a', meta: true, shift: true,
        action: () => {
          const store = useTabsStore.getState();
          const tab = store.tabs.find((t) => t.id === store.activeTabId);
          if (!tab?.focusedPaneId) return;
          const leaf = findLeaf(tab.paneRoot, tab.focusedPaneId);
          if (leaf && leaf.ptyId > 0) {
            useAgentStore.getState().toggleManualOverride(leaf.ptyId);
          }
        },
      },
    ],
    [handleSplit, handleClose, navigatePanes, addTab, switchTabByIndex, switchTabRelative, toggleSidebar, setOverlayOpen],
  );

  useKeyboardRegistry(bindings);

  const hasContext = useTabsStore((s) => s.activeContextId !== '');

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-primary">
      <div className="flex-1 min-h-0 flex flex-row">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          {hasContext ? (
            <>
              <TabBar />
              <div className="flex-1 min-h-0 relative">
                {activeTab && (
                  <div key={activeTab.id} className="absolute inset-0">
                    <PaneContainer root={activeTab.paneRoot} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
              <span className="text-lg font-semibold text-text-primary">No workspace selected</span>
              <span className="text-sm text-center max-w-[280px]">
                Import a git repository and select a branch or worktree to start working.
              </span>
              <button
                className="mt-2 px-4 h-8 bg-bg-tertiary text-text-muted hover:text-[var(--accent)] cursor-pointer"
                style={{ fontSize: '13px', borderRadius: '4px' }}
                onClick={() => {
                  useWorkspaceStore.getState().toggleSidebar();
                }}
              >
                Open Sidebar (⌘B)
              </button>
            </div>
          )}
        </div>
      </div>
      <StatusBar />
      <ErrorToastRegion />
      <AgentOverlay isOpen={overlayOpen} onClose={() => setOverlayOpen(false)} />
      <AgentToastRegion />
    </div>
  );
}
