import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { agentCollection } from '@superagent/db';
import { Sidebar } from '../components/Sidebar';
import { StatusBar } from '../components/StatusBar';
import { ErrorToastRegion } from '../components/ToastProvider';
import { AgentOverlay } from '../components/AgentOverlay';
import { AgentToastRegion } from '../components/AgentToastRegion';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { initAgentListener, toggleManualOverride } from '../lib/agent-actions';
import {
  addTab,
  closeTab,
  closePane,
  splitPane,
  navigate as navigatePanes,
  switchTabByIndex,
  switchTabRelative,
  getActiveTab,
} from '../lib/tab-actions';
import { toggleSidebar } from '../lib/workspace-actions';
import { closePty } from '../lib/pty';
import { disposeCached } from '../lib/terminal-cache';
import { findLeaf } from '../lib/pane-tree-ops';
import type { PaneNode } from '../lib/pane-tree-ops';
import { showErrorToast, showAgentToastDeduped } from '../lib/toast';
import { getTabCollection, getWorkspaceCollection, getSettingCollection, getSetting } from '@superagent/db';

function containsPtyId(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((child) => containsPtyId(child, ptyId));
}

function RootLayout() {
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Initialize agent event listener on mount
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    initAgentListener().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Subscribe to agent collection changes for non-active workspace toasts
  useEffect(() => {
    const sub = agentCollection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === 'delete') continue;
        const agent = change.value;
        const tabs = getTabCollection().toArray;
        const activeTabId = getActiveTab()?.id;
        const agentTab = tabs.find((t) => containsPtyId(t.paneRoot, agent.ptyId));
        if (!agentTab || agentTab.id === activeTabId) continue;

        const workspaces = getWorkspaceCollection().toArray;
        const ws = workspaces.find((w) => agentTab.workspaceItemId.startsWith(w.id));

        if (agent.status === 'waiting') {
          showAgentToastDeduped({
            type: 'agent-waiting',
            agentName: agent.agentName,
            workspace: ws?.name ?? 'Unknown',
            branch: agentTab.label,
            ptyId: agent.ptyId,
          });
        }
      }
    });
    return () => sub.unsubscribe();
  }, []);

  // Apply theme from settings on mount
  useEffect(() => {
    const settings = getSettingCollection().toArray;
    const theme = getSetting(settings, 'theme', 'obsidian') as string;
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    const activeTab = getActiveTab();
    if (!activeTab?.focusedPaneId) return;
    try {
      splitPane(activeTab.focusedPaneId, direction, -1);
    } catch (err) {
      showErrorToast('Failed to split pane', String(err));
    }
  }, []);

  const handleClose = useCallback(async () => {
    const activeTab = getActiveTab();
    if (!activeTab?.focusedPaneId) return;

    if (activeTab.paneRoot.type === 'leaf') {
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
  }, []);

  const bindings: Keybinding[] = useMemo(
    () => [
      { key: 'd', meta: true, action: () => handleSplit('horizontal') },
      { key: 'd', meta: true, shift: true, action: () => handleSplit('vertical') },
      { key: 'w', meta: true, action: () => handleClose() },
      { key: 'ArrowLeft', meta: true, alt: true, action: () => navigatePanes('left') },
      { key: 'ArrowRight', meta: true, alt: true, action: () => navigatePanes('right') },
      { key: 'ArrowUp', meta: true, alt: true, action: () => navigatePanes('up') },
      { key: 'ArrowDown', meta: true, alt: true, action: () => navigatePanes('down') },
      { key: 't', meta: true, action: () => addTab() },
      ...Array.from({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        meta: true,
        action: () => switchTabByIndex(i),
      })),
      { key: '[', meta: true, shift: true, action: () => switchTabRelative('prev') },
      { key: ']', meta: true, shift: true, action: () => switchTabRelative('next') },
      { key: 'b', meta: true, action: () => toggleSidebar() },
      { key: 'o', meta: true, shift: true, action: () => setOverlayOpen((prev) => !prev) },
      {
        key: 'a',
        meta: true,
        shift: true,
        action: () => {
          const activeTab = getActiveTab();
          if (!activeTab?.focusedPaneId) return;
          const leaf = findLeaf(activeTab.paneRoot, activeTab.focusedPaneId);
          if (leaf && leaf.ptyId > 0) {
            toggleManualOverride(leaf.ptyId);
          }
        },
      },
    ],
    [handleSplit, handleClose],
  );

  useKeyboardRegistry(bindings);


  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-primary">
      <div className="flex-1 min-h-0 flex flex-row">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Outlet />
        </div>
      </div>
      <StatusBar />
      <ErrorToastRegion />
      <AgentOverlay isOpen={overlayOpen} onClose={() => setOverlayOpen(false)} />
      <AgentToastRegion />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
