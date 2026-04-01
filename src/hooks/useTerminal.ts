import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { writeToPty, resizePty, connectPtyOutput } from '../lib/pty';
import { getCached, setCached } from '../lib/terminal-cache';
import { useThemeStore } from '../stores/theme-store';
import { xtermThemes } from '../lib/themes';

/**
 * Hook to manage an xterm.js terminal instance connected to an existing PTY.
 *
 * Terminal instances are cached globally so they survive React remounts
 * caused by pane tree restructuring (split/close). On remount, the existing
 * xterm DOM is reparented into the new container — preserving scrollback.
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

    // Check for cached terminal instance (survives React remounts)
    const cached = getCached(ptyId);
    let term: Terminal;
    let fitAddon: FitAddon;

    if (cached) {
      // Reuse existing instance — reparent DOM into new container
      term = cached.term;
      fitAddon = cached.fitAddon;
      const el = term.element;
      if (el) {
        container.appendChild(el);
      }
      // Re-wire output to this (same) instance and re-fit
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
      fitAddon.fit();
      resizePty(ptyId, term.rows, term.cols);
    } else {
      // First mount — create new terminal
      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: xtermThemes[useThemeStore.getState().currentTheme],
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
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

      // Wire PTY output → xterm
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));

      // OSC 7 CWD detection: shells emit OSC 7 with file:// URI for cwd
      term.parser.registerOscHandler(7, (data: string) => {
        try {
          const url = new URL(data);
          const cwd = decodeURIComponent(url.pathname);
          if (cwd && onCwdChangeRef.current) {
            onCwdChangeRef.current(cwd);
          }
        } catch {
          if (data && onCwdChangeRef.current) {
            onCwdChangeRef.current(data);
          }
        }
        return true;
      });

      // Prevent xterm from swallowing app-level keyboard shortcuts
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (!e.metaKey) return true;
        // Pane shortcuts
        if (e.key === 'd' && !e.shiftKey) return false;
        if (e.key === 'D' && e.shiftKey) return false;
        if (e.key === 'w') return false;
        if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          return false;
        }
        // Tab shortcuts -- let bubble to keyboard registry
        if (e.key === 't' && !e.shiftKey) return false; // Cmd+T
        if (e.key >= '1' && e.key <= '9') return false; // Cmd+1-9
        if ((e.key === '[' || e.key === ']') && e.shiftKey) return false; // Cmd+Shift+[/]
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

      // Cache for future remounts
      setCached(ptyId, term, fitAddon);
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle resize with debounced PTY resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();

      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        resizePty(ptyId, term.rows, term.cols);
        resizeTimerRef.current = null;
      }, 100);
    });
    resizeObserver.observe(container);

    if (isFocused) {
      term.focus();
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
      }
      // DON'T dispose — just detach from container. Cache keeps it alive.
      const el = term.element;
      if (el && el.parentNode === container) {
        container.removeChild(el);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ptyId]);

  return termRef;
}
