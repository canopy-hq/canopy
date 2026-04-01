import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { writeToPty, resizePty } from '../lib/pty';

/**
 * Hook to manage an xterm.js terminal instance connected to an existing PTY.
 *
 * The PTY must already be spawned externally (by TerminalPane sentinel logic).
 * This hook wires xterm input/output to the given ptyId.
 */
export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  ptyId: number,
  isFocused: boolean,
  onCwdChange?: (cwd: string) => void,
): React.MutableRefObject<Terminal | null> {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCwdChangeRef = useRef(onCwdChange);

  // Keep callback ref in sync without triggering effect re-runs
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  // Focus xterm when isFocused becomes true
  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a14',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(container);

    // WebGL must load AFTER open()
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });
    term.loadAddon(webglAddon);

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // OSC 7 CWD detection: shells emit OSC 7 with file:// URI for cwd
    term.parser.registerOscHandler(7, (data: string) => {
      try {
        // OSC 7 format: file://hostname/path
        const url = new URL(data);
        const cwd = decodeURIComponent(url.pathname);
        if (cwd && onCwdChangeRef.current) {
          onCwdChangeRef.current(cwd);
        }
      } catch {
        // If data is a plain path (not a URL), use it directly
        if (data && onCwdChangeRef.current) {
          onCwdChangeRef.current(data);
        }
      }
      return true;
    });

    // Prevent xterm from swallowing app-level keyboard shortcuts
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (!e.metaKey) return true;
      // Cmd+D (split horizontal)
      if (e.key === 'd' && !e.shiftKey) return false;
      // Cmd+Shift+D (split vertical)
      if (e.key === 'D' && e.shiftKey) return false;
      // Cmd+W (close pane)
      if (e.key === 'w') return false;
      // Cmd+Option+Arrow (navigate panes)
      if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        return false;
      }
      return true;
    });

    // Wire user input to PTY
    term.onData((data: string) => {
      writeToPty(ptyId, data);
    });

    term.onBinary((data: string) => {
      const bytes = Array.from(data, (c) => c.charCodeAt(0));
      writeToPty(ptyId, String.fromCharCode(...bytes));
    });

    // Sync initial size
    resizePty(ptyId, term.rows, term.cols);

    // Handle resize with debounced PTY resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();

      // Debounce resizePty at 100ms
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        resizePty(ptyId, term.rows, term.cols);
        resizeTimerRef.current = null;
      }, 100);
    });
    resizeObserver.observe(container);

    // Focus if initially focused
    if (isFocused) {
      term.focus();
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
      }
      term.dispose();
    };
    // ptyId is the PTY identity -- if it changes, we need a full teardown/rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ptyId]);

  return termRef;
}
