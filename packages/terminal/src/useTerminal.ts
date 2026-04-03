import { useEffect, useRef, useState } from 'react';

import { getSettingCollection, getSetting } from '@superagent/db';
import { Terminal, FitAddon } from 'ghostty-web';

import { ensureGhosttyInit } from './ghostty-init';
import {
  writeToPty,
  resizePty,
  connectPtyOutput,
  connectPtyOutputFresh,
  spawnTerminal,
} from './pty';
import { getCached, setCached } from './terminal-cache';
import { terminalThemes, type ThemeName } from './themes';

/**
 * Hook to manage a ghostty-web terminal instance connected to a PTY.
 *
 * When ptyId === -1, spawns a new PTY *after* fitting the terminal to the container
 * so the daemon receives exact grid dimensions — eliminating the spurious SIGWINCH
 * that would otherwise cause zsh to reprint its prompt and add a blank line.
 *
 * Terminal instances are cached globally so they survive React remounts caused by
 * pane tree restructuring (split/close). On remount, the existing terminal DOM is
 * reparented into the new container — preserving scrollback.
 *
 * Overlay + sentinel protocol
 * ---------------------------
 * For new spawns, an opaque overlay covers the canvas until the first LIVE byte
 * arrives. "Live" is defined as post-sentinel: the daemon sends a zero-length
 * sentinel frame after replaying scrollback, so all data arriving after the
 * sentinel is guaranteed fresh. connectPtyOutputFresh buffers and discards
 * everything up to and including the sentinel.
 */
export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  paneId: string,
  savedCwd: string | undefined,
  ptyId: number,
  isFocused: boolean,
  onPtySpawned: (id: number) => void,
): React.MutableRefObject<Terminal | null> {
  const termRef = useRef<Terminal | null>(null);
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    void ensureGhosttyInit().then(() => setWasmReady(true));
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

    let spawnCancelled = false;
    let sigwinchTimer: ReturnType<typeof setTimeout> | null = null;
    let overlayTimeoutId: ReturnType<typeof setTimeout> | null = null;
    // Hoisted so cleanup can always call it (no-op for the cached path).
    let removeOverlay = () => {};
    const cached = getCached(ptyId);
    let term: Terminal;
    let fitAddon: FitAddon;

    // Compute theme background early — needed for overlay in the new-terminal path.
    const themeBg =
      terminalThemes[getSetting(getSettingCollection().toArray, 'theme', 'obsidian') as ThemeName]
        .background;

    if (cached) {
      // === CACHED PATH: remount after pane restructure — re-parent existing terminal ===
      term = cached.term;
      fitAddon = cached.fitAddon;
      const el = term.element;
      if (el) {
        container.appendChild(el);
      }
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
      fitAddon.fit();
    } else {
      // === NEW TERMINAL: spawn (ptyId === -1) or reconnect (ptyId > 0) ===
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme:
          terminalThemes[
            getSetting(getSettingCollection().toArray, 'theme', 'obsidian') as ThemeName
          ],
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // ghostty-web sets term.element = the element passed to open(), not a new
      // child element. Opening directly into the React-managed container would
      // make term.element === container, causing container.appendChild(container)
      // (HierarchyRequestError) in the cached remount path. Use a wrapper div so
      // term.element is always a separate, moveable element.
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;width:100%;height:100%';
      wrapper.style.background = themeBg;
      container.appendChild(wrapper);
      term.open(wrapper);
      // Clear any stale WASM state that may persist from a previously disposed
      // terminal instance (ghostty-web WASM allocator may reuse heap memory).
      term.reset();
      // Opaque overlay covering the canvas to prevent a flash of blank content.
      //
      // Removal strategy differs by path:
      //  • isNew=true  (fresh spawn): removed on first live post-sentinel byte so the
      //    user never sees a blank canvas before the shell prompt appears.
      //  • isNew=false (restored) / reconnect: removed immediately after connectPtyOutput
      //    because setHandler drains buffered scrollback synchronously — an idle shell
      //    would never produce bytes, leaving the overlay up permanently.
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:absolute;inset:0;background:${themeBg};z-index:1;pointer-events:none`;
      wrapper.appendChild(overlay);
      let overlayRemoved = false;
      removeOverlay = () => {
        if (!overlayRemoved) {
          overlayRemoved = true;
          overlay.remove();
        }
      };

      if (term.element) {
        // Prevent macOS press-and-hold accent popup on ghostty-web's hidden textarea.
        term.element.querySelector('textarea')?.setAttribute('inputmode', 'none');
      }

      // Mutable ref so async callbacks always use the current ptyId.
      // Spawn path: starts at -1, updated after spawnTerminal resolves.
      // Reconnect path: starts at the real ptyId immediately.
      const ptrRef = { ptyId };

      // macOS press-and-hold fix: bypass ghostty-web's isComposing block for repeated keys.
      const termElement = term.element;
      if (termElement) {
        termElement.addEventListener(
          'keydown',
          (e: KeyboardEvent) => {
            // macOS system shortcuts: stop ghostty-web from consuming them,
            // but do NOT preventDefault so the native menu handler fires.
            if (e.metaKey && 'qhm,'.includes(e.key)) {
              e.stopImmediatePropagation();
              return;
            }
            if (e.repeat && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.stopImmediatePropagation();
              e.preventDefault();
              if (ptrRef.ptyId > 0) void writeToPty(ptrRef.ptyId, e.key);
            }
          },
          true,
        );
      }

      // Dedup guard: only send a resize IPC when dimensions actually changed.
      // Starts at {0,0} so the first meaningful fit always fires.
      // For the spawn path, lastSentSize is updated to the exact spawn dims after
      // spawnTerminal resolves, ensuring subsequent fits at the same size are no-ops.
      const lastSentSize = { rows: 0, cols: 0 };
      term.onResize(({ cols, rows }) => {
        if (ptrRef.ptyId <= 0) return; // suppress during pre-spawn phase
        if (rows === lastSentSize.rows && cols === lastSentSize.cols) return;
        lastSentSize.rows = rows;
        lastSentSize.cols = cols;
        void resizePty(ptrRef.ptyId, rows, cols);
      });

      // ghostty-web: return true = "handled, stop", false = "let terminal handle"
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (!e.metaKey) return false;
        if (e.key === 'b') return true; // Sidebar toggle
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
        if (ptrRef.ptyId > 0) void writeToPty(ptrRef.ptyId, data);
      });

      // Fit terminal to container to obtain exact grid dimensions.
      // onResize is suppressed here (ptrRef.ptyId <= 0 for spawn path;
      // for reconnect, the first real resize fires via onResize automatically).
      fitAddon.fit();

      if (ptyId > 0) {
        // Reconnect: PTY already running in daemon (cold app restart).
        // lastSentSize is {0,0} so onResize from fitAddon.fit() above already sent
        // the resize IPC — no explicit call needed here.
        // setHandler drains buffered scrollback synchronously — remove overlay now
        // rather than waiting for future bytes that may never arrive (idle shell).
        connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
        removeOverlay();
        setCached(ptyId, term, fitAddon);
      } else {
        // Spawn: PTY started at exact fitted dimensions → lastSentSize = spawn dims
        // → dedup guard suppresses any subsequent fit at the same size → 0 SIGWINCH.
        void spawnTerminal(paneId, savedCwd, term.rows, term.cols).then(({ ptyId: newId, isNew }) => {
          if (spawnCancelled) return;
          ptrRef.ptyId = newId;
          lastSentSize.rows = term.rows;
          lastSentSize.cols = term.cols;
          if (isNew) {
            // Fresh shell: discard scrollback replay, wait for first live byte.
            // Safety timeout in case the shell never outputs (crash, slow startup).
            overlayTimeoutId = setTimeout(removeOverlay, 2000);
            connectPtyOutputFresh(newId, (data: Uint8Array) => {
              if (overlayTimeoutId !== null) {
                clearTimeout(overlayTimeoutId);
                overlayTimeoutId = null;
              }
              removeOverlay();
              term.write(data);
            });
          } else {
            // Restored session: setHandler synchronously flushed all buffered scrollback
            // above — remove overlay immediately so an idle shell isn't permanently blank.
            connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
            removeOverlay();
          }
          setCached(newId, term, fitAddon);
          onPtySpawned(newId);

          // Poll dimensions for 1s after spawn (every 200ms, up to 5 ticks).
          // Handles layout-settling races (sidebars, borders, split panes) and
          // ensures TUI apps like Claude Code fill the pane on first launch.
          // Stops early once dims stabilize.
          let ticks = 0;
          const poll = () => {
            sigwinchTimer = null;
            if (spawnCancelled) return;
            const dims = fitAddon.proposeDimensions();
            const r = dims?.rows ?? lastSentSize.rows;
            const c = dims?.cols ?? lastSentSize.cols;
            const changed = r !== lastSentSize.rows || c !== lastSentSize.cols;
            if (changed) {
              term.resize(c, r);
              lastSentSize.rows = r;
              lastSentSize.cols = c;
              void resizePty(newId, r, c);
            } else if (ticks === 0 && isNew) {
              // Fresh shell only: always send SIGWINCH so TUI apps initialise.
              // Restored sessions (isNew=false) already have the correct size —
              // a spurious SIGWINCH causes zsh to reprint its prompt below the
              // replayed scrollback, shifting the viewport and making the session
              // appear empty.
              void resizePty(newId, r, c);
            }
            ticks++;
            if (ticks < 5) sigwinchTimer = setTimeout(poll, 200);
          };
          sigwinchTimer = setTimeout(poll, 100);
        });
      }
    }

    termRef.current = term;

    // Debounced resize: background fills gap during macOS window animations.
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
      spawnCancelled = true;
      removeOverlay();
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (sigwinchTimer !== null) clearTimeout(sigwinchTimer);
      if (overlayTimeoutId !== null) clearTimeout(overlayTimeoutId);
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
