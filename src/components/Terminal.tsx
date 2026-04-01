import '@xterm/xterm/css/xterm.css';
import { PaneContainer } from './PaneContainer';

/**
 * Top-level terminal view. Delegates to PaneContainer which
 * recursively renders the pane tree from the Zustand store.
 *
 * Kept as a wrapper for App.tsx compatibility; the real logic
 * lives in PaneContainer -> TerminalPane -> useTerminal.
 */
export function TerminalView() {
  return (
    <div className="h-full w-full">
      <PaneContainer />
    </div>
  );
}
