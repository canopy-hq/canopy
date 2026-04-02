import { useEffect, useRef, useState } from 'react';
import { Terminal, FitAddon } from 'ghostty-web';
import { writeToPty, resizePty, connectPtyOutput } from '../lib/pty';
import { getCached, setCached } from '../lib/terminal-cache';
import { useThemeStore } from '../stores/theme-store';
import { terminalThemes } from '../lib/themes';
import { ensureGhosttyInit } from '../lib/ghostty-init';

/**
 * Hook to manage a ghostty-web terminal instance connected to an existing PTY.
 *
 * Terminal instances are cached globally so they survive React remounts
 * caused by pane tree restructuring (split/close). On remount, the existing
 * terminal DOM is reparented into the new container — preserving scrollback.
 */
export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  ptyId: number,
  isFocused: boolean,
): React.MutableRefObject<Terminal | null> {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [wasmReady, setWasmReady] = useState(false);

  // Wait for WASM to be initialized before creating terminals
  useEffect(() => {
    ensureGhosttyInit().then(() => setWasmReady(true));
  }, []);

  // Focus terminal when isFocused becomes true
  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  useEffect(() => {
    if (!wasmReady) return;

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
        theme: terminalThemes[useThemeStore.getState().currentTheme],
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);

      // Add padding so terminal content isn't flush against edges
      if (term.element) {
        term.element.style.padding = '8px 12px';
        term.element.style.boxSizing = 'border-box';
      }

      // macOS press-and-hold fix: when a key is held, macOS triggers composition
      // mode (accent picker) which causes ghostty-web to ignore repeated keydown
      // events (isComposing check). We intercept repeated printable keys in capture
      // phase and send them directly to PTY, bypassing ghostty-web's input handler.
      const termElement = term.element;
      if (termElement) {
        termElement.addEventListener(
          'keydown',
          (e: KeyboardEvent) => {
            if (
              e.repeat &&
              e.key.length === 1 &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.altKey
            ) {
              e.stopImmediatePropagation();
              e.preventDefault();
              writeToPty(ptyId, e.key);
            }
          },
          true, // capture phase — fires before ghostty-web's bubble listener
        );
      }

      fitAddon.fit();

      // Wire PTY output → terminal
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));

      // Sync PTY size on terminal resize events
      term.onResize(({ cols, rows }) => {
        resizePty(ptyId, rows, cols);
      });

      // Intercept app-level keyboard shortcuts before the terminal processes them.
      // ghostty-web convention: return true = "handled, stop processing", false = "let terminal handle"
      // (opposite of xterm.js where true = "let terminal handle")
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (!e.metaKey) return false;
        // Pane shortcuts
        if (e.key === 'd' && !e.shiftKey) return true;
        if (e.key === 'D' && e.shiftKey) return true;
        if (e.key === 'w') return true;
        if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          return true;
        }
        // Tab shortcuts -- let bubble to keyboard registry
        if (e.key === 't' && !e.shiftKey) return true; // Cmd+T
        if (e.key >= '1' && e.key <= '9') return true; // Cmd+1-9
        if ((e.key === '[' || e.key === ']') && e.shiftKey) return true; // Cmd+Shift+[/]
        return false;
      });

      // Wire user input to PTY
      term.onData((data: string) => {
        writeToPty(ptyId, data);
      });

      // Sync initial size
      resizePty(ptyId, term.rows, term.cols);

      // Cache for future remounts
      setCached(ptyId, term, fitAddon);
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Smooth resize: keep canvas at current size during macOS window
    // animations — extra space is filled by the container background which
    // matches the terminal theme. Once events settle (100ms), fit() snaps
    // to the new size. Same strategy as iTerm2 / native terminals.
    const themeBg = terminalThemes[useThemeStore.getState().currentTheme].background;
    if (term.element) term.element.style.background = themeBg;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        fitAddon.fit();
      }, 100);
    });
    resizeObserver.observe(container);

    if (isFocused) {
      term.focus();
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      // DON'T dispose term — just detach from container. Cache keeps it alive.
      const el = term.element;
      if (el && el.parentNode === container) {
        container.removeChild(el);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ptyId, wasmReady]);

  return termRef;
}
