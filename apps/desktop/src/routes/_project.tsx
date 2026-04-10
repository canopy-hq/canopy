import { useCallback, useMemo } from 'react';

import { getSetting } from '@superagent/db';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { Sidebar } from '../components/Sidebar';
import { useSettings, useUiState } from '../hooks/useCollections';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { toggleManualOverride } from '../lib/agent-actions';
import { DEFAULT_EDITOR_SETTING_KEY, openInEditor, useDetectedEditors } from '../lib/editor';
import { findLeaf } from '../lib/pane-tree-ops';
import {
  addTab,
  closeTab,
  closePane,
  splitPane,
  navigate as navigatePanes,
  switchTabRelative,
  getActiveTab,
  resolveProjectItemCwd,
} from '../lib/tab-actions';
import { showErrorToast } from '../lib/toast';

function ProjectLayout() {
  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    const activeTab = getActiveTab();
    if (!activeTab?.focusedPaneId) return;
    try {
      splitPane(activeTab.focusedPaneId, direction, -1);
    } catch (err) {
      showErrorToast('Failed to split pane', String(err));
    }
  }, []);

  const editors = useDetectedEditors();
  const settings = useSettings();
  const uiState = useUiState();

  const handleClose = useCallback(() => {
    const activeTab = getActiveTab();
    if (!activeTab?.focusedPaneId) return;

    if (activeTab.paneRoot.type === 'leaf') {
      closeTab(activeTab.id);
    } else {
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
      {
        // Use `code` instead of `key` — on macOS WebKit, e.key returns 'E'
        // (uppercase) when Shift is held, which fails the exact-match check.
        code: 'KeyE',
        meta: true,
        shift: true,
        condition: () => editors.length > 0 && !!uiState.activeContextId,
        action: () => {
          const defaultEditorId = getSetting<string>(settings, DEFAULT_EDITOR_SETTING_KEY, '');
          const editor = editors.find((e) => e.id === defaultEditorId) ?? editors[0];
          if (!editor || !uiState.activeContextId) return;
          const cwd = resolveProjectItemCwd(uiState.activeContextId);
          if (!cwd) return;
          openInEditor(editor.id, cwd).catch((err) => {
            showErrorToast('Failed to open editor', String(err));
          });
        },
      },
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
    [handleSplit, handleClose, editors, settings, uiState],
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

export const Route = createFileRoute('/_project')({ component: ProjectLayout });
