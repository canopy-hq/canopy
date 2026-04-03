import { useCallback, useMemo } from 'react';

import { closePty, disposeCached } from '@superagent/terminal';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { Sidebar } from '../components/Sidebar';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { toggleManualOverride } from '../lib/agent-actions';
import { findLeaf } from '../lib/pane-tree-ops';
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
import { showErrorToast } from '../lib/toast';

function WorkspaceLayout() {
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
      {
        key: 'a',
        meta: true,
        shift: true,
        action: () => {
          const activeTab = getActiveTab();
          if (!activeTab?.focusedPaneId) return;
          const leaf = findLeaf(activeTab.paneRoot, activeTab.focusedPaneId);
          if (leaf && leaf.ptyId > 0) toggleManualOverride(leaf.ptyId);
        },
      },
    ],
    [handleSplit, handleClose],
  );

  useKeyboardRegistry(bindings);

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_workspace')({ component: WorkspaceLayout });
