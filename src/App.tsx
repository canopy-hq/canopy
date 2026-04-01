import { useCallback, useMemo } from 'react';
import { PaneContainer } from './components/PaneContainer';
import { ErrorToastRegion } from './components/ToastProvider';
import { useKeyboardRegistry, type Keybinding } from './hooks/useKeyboardRegistry';
import { usePaneTreeStore } from './stores/pane-tree';
import { closePty } from './lib/pty';
import { disposeCached } from './lib/terminal-cache';
import { findLeaf } from './lib/pane-tree-ops';
import { showErrorToast } from './lib/toast';

export default function App() {
  const focusedPaneId = usePaneTreeStore((s) => s.focusedPaneId);
  const splitPane = usePaneTreeStore((s) => s.splitPane);
  const closePane = usePaneTreeStore((s) => s.closePane);
  const navigatePanes = usePaneTreeStore((s) => s.navigate);

  // Split handler: pass ptyId=-1 (sentinel). TerminalPane spawns PTY on mount.
  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!focusedPaneId) return;
      try {
        splitPane(focusedPaneId, direction, -1);
      } catch (err) {
        showErrorToast('Failed to split pane', String(err));
      }
    },
    [focusedPaneId, splitPane],
  );

  // Close handler: close PTY backend, then remove from tree.
  // closePane handles last-pane case by creating sentinel leaf (ptyId=-1).
  // TerminalPane will detect sentinel and spawn fresh PTY.
  const handleClose = useCallback(async () => {
    if (!focusedPaneId) return;
    const store = usePaneTreeStore.getState();
    const leaf = findLeaf(store.root, focusedPaneId);
    if (leaf && leaf.ptyId > 0) {
      disposeCached(leaf.ptyId);
      try {
        await closePty(leaf.ptyId);
      } catch {
        // PTY may already be dead -- proceed with removal
      }
    }
    closePane(focusedPaneId);
  }, [focusedPaneId, closePane]);

  // Keyboard shortcuts (KEYS-01)
  const bindings: Keybinding[] = useMemo(
    () => [
      { key: 'd', meta: true, action: () => handleSplit('horizontal') },
      { key: 'd', meta: true, shift: true, action: () => handleSplit('vertical') },
      { key: 'w', meta: true, action: () => handleClose() },
      { key: 'ArrowLeft', meta: true, alt: true, action: () => navigatePanes('left') },
      { key: 'ArrowRight', meta: true, alt: true, action: () => navigatePanes('right') },
      { key: 'ArrowUp', meta: true, alt: true, action: () => navigatePanes('up') },
      { key: 'ArrowDown', meta: true, alt: true, action: () => navigatePanes('down') },
    ],
    [handleSplit, handleClose, navigatePanes],
  );

  useKeyboardRegistry(bindings);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a14]">
      <PaneContainer />
      <ErrorToastRegion />
    </div>
  );
}
