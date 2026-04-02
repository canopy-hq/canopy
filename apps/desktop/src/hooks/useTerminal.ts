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
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    ensureGhosttyInit().then(() => setWasmReady(true));
  }, []);

  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  useEffect(() => {
    if (!wasmReady) return;

    const container = containerRef.current;
    if (!container) return;

    const cached = getCached(ptyId);
    let term: Terminal;
    let fitAddon: FitAddon;

    if (cached) {
      term = cached.term;
      fitAddon = cached.fitAddon;
      const el = term.element;
      if (el) {
        container.appendChild(el);
      }
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
      fitAddon.fit();
      resizePty(ptyId, term.rows, term.cols);
    } else {
      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: terminalThemes[useThemeStore.getState().currentTheme],
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);

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
            // macOS system shortcuts: stop ghostty-web from consuming them,
            // but do NOT preventDefault so the native menu handler fires
            if (e.metaKey && 'qhm,'.includes(e.key)) {
              e.stopImmediatePropagation();
              return;
            }
            // macOS press-and-hold fix: bypass ghostty-web's isComposing block
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
          true,
        );
      }

      fitAddon.fit();

      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));

      term.onResize(({ cols, rows }) => {
        resizePty(ptyId, rows, cols);
      });

      // ghostty-web: return true = "handled, stop", false = "let terminal handle"
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (!e.metaKey) return false;
        if (e.key === 'd' && !e.shiftKey) return true;
        if (e.key === 'D' && e.shiftKey) return true;
        if (e.key === 'w') return true;
        if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          return true;
        }
        // Tab shortcuts
        if (e.key === 't' && !e.shiftKey) return true;
        if (e.key >= '1' && e.key <= '9') return true;
        if ((e.key === '[' || e.key === ']') && e.shiftKey) return true;
        return false;
      });

      term.onData((data: string) => {
        writeToPty(ptyId, data);
      });

      resizePty(ptyId, term.rows, term.cols);
      setCached(ptyId, term, fitAddon);
    }

    termRef.current = term;

    // Debounced resize: background fills gap during macOS window animations
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
