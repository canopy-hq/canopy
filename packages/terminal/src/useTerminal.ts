import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getSettingCollection, getSetting } from '@superagent/db';
import { Terminal, FitAddon } from 'ghostty-web';

import { ensureGhosttyInit, isGhosttyReady } from './ghostty-init';
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
  onCommand?: (cmd: string) => void,
): React.MutableRefObject<Terminal | null> {
  const termRef = useRef<Terminal | null>(null);
  // Sync check: if WASM was pre-initialized (ensureGhosttyInit called at app startup),
  // skip the extra render cycle where wasmReady transitions false → true.
  const [wasmReady, setWasmReady] = useState(() => isGhosttyReady());
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  useEffect(() => {
    if (!wasmReady) {
      void ensureGhosttyInit().then(() => setWasmReady(true));
    }
  }, [wasmReady]);

  // Freeze ptyId for the main effect: the spawn path manages the -1 → realId
  // transition internally via ptrRef. Only fresh mounts (cached remount or
  // reconnect) need the real ptyId, which is captured at mount time.
  // This prevents the destructive effect re-run that removes and re-adds the
  // terminal element to the DOM, causing flicker.
  const effectPtyId = useRef(ptyId);
  // Track the previous ptyId to detect spawn-completion transitions (-1 → pid).
  const prevPtyId = useRef(ptyId);

  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  // Synchronous resize before paint: when ptyId becomes a real pid (pane remount),
  // fire fitAddon.fit() + resizePty in the layout phase — before the browser renders
  // the first frame with the new ptyId.
  //
  // Skip when ptyId transitions from ≤0 to >0 (spawn completion): the terminal was
  // just created at exact container dimensions — sending resizePty here would deliver
  // a redundant SIGWINCH that interrupts shell/Starship initialization, causing blank
  // background artifacts in the prompt.
  useLayoutEffect(() => {
    const wasSpawnTransition = prevPtyId.current <= 0 && ptyId > 0;
    prevPtyId.current = ptyId;
    if (!wasmReady || ptyId <= 0) return;
    if (wasSpawnTransition) return;
    const cached = getCached(ptyId);
    if (!cached) return;
    cached.fitAddon.fit();
    const { rows, cols } = cached.term;
    if (rows > 0 && cols > 0) {
      void resizePty(ptyId, rows, cols);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId, wasmReady]);

  useEffect(() => {
    const container = containerRef.current;
    // Compute theme background once — used for early container paint, overlay, and wrapper.
    const themeBg =
      terminalThemes[getSetting(getSettingCollection().toArray, 'theme', 'obsidian') as ThemeName]
        .background;
    if (container) {
      // Set terminal background early so the container isn't a blank hole
      // while WASM loads or the PTY spawns.
      container.style.background = themeBg;
    }
    if (!wasmReady) return;

    if (!container) return;

    // Read the frozen ptyId — for spawn this is -1 (captured at mount);
    // for cached remount / reconnect it is the real ptyId.
    const ptyId = effectPtyId.current;

    let spawnCancelled = false;
    let ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
    // Hoisted so cleanup can always call it (no-op for the cached path).
    let removeOverlay = () => {};
    const cached = getCached(ptyId);
    let term: Terminal;
    let fitAddon: FitAddon;

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
      // Unconditional resize IPC on cached remount — ptyId is the real pid,
      // proxy.sessions is already populated, so this call succeeds immediately.
      void resizePty(ptyId, term.rows, term.cols);
    } else {
      // === NEW TERMINAL: spawn (ptyId === -1) or reconnect (ptyId > 0) ===
      const termFontSize = 14;
      const termFontFamily = '"Geist Mono", Menlo, Monaco, "Courier New", monospace';
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: termFontSize,
        fontFamily: termFontFamily,
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
      //
      // Defensive CSS: ghostty's open() sets contenteditable="true" on this
      // wrapper, which can cause browsers to apply implicit padding/outline.
      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'position:relative;width:100%;height:100%;outline:none;padding:0;margin:0;border:none';
      wrapper.style.background = themeBg;
      container.appendChild(wrapper);

      // Opaque overlay covering the canvas until the first LIVE PTY byte arrives.
      // MUST be appended BEFORE term.open() — ghostty's open() internally calls
      // renderer.render(), startRenderLoop(), and focus(), which paint the cursor
      // on the canvas immediately. Without the overlay already in place, the cursor
      // flashes for 1-2 frames before being covered.
      //
      // "Live" is defined as post-sentinel: the daemon sends a zero-length sentinel
      // frame after replaying scrollback (see daemon.rs attach handler). The
      // connectPtyOutputFresh call buffers and silently discards all data up to and
      // including the sentinel. The overlay is therefore removed only when fresh
      // shell output (e.g. the zsh prompt) first hits the canvas.
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:absolute;inset:0;background:${themeBg};z-index:1;pointer-events:none`;
      wrapper.appendChild(overlay);

      term.open(wrapper);
      let overlayRemoved = false;
      let overlayTimer: ReturnType<typeof setTimeout> | null = null;
      removeOverlay = () => {
        if (!overlayRemoved) {
          overlayRemoved = true;
          if (overlayTimer !== null) {
            clearTimeout(overlayTimer);
            overlayTimer = null;
          }
          overlay.remove();
        }
      };
      // Debounced removal: waits for output AND rendering to settle before
      // revealing. The debounce covers Starship prompt output; the double-rAF
      // ensures the WASM renderer has painted at least one full frame after the
      // last write — critical on the first two terminals when the renderer is
      // cold-starting (JIT, texture atlases, etc.).
      const debouncedRemoveOverlay = () => {
        if (overlayRemoved) return;
        if (overlayTimer !== null) clearTimeout(overlayTimer);
        overlayTimer = setTimeout(() => {
          overlayTimer = null;
          // Double rAF: first rAF queues work for the current frame's paint,
          // second rAF fires after that paint completes → canvas is up-to-date.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              removeOverlay();
            });
          });
        }, 150);
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
      // Grace period: suppress resize IPC for 500ms after spawn to let React
      // re-renders and layout settle. Prevents spurious SIGWINCH that causes
      // zsh/Starship to redraw the prompt (visible as flicker on version badges).
      // After the grace period, one final sync resize is sent.
      let resizeGraceUntil = 0;
      term.onResize(({ cols, rows }) => {
        if (ptrRef.ptyId <= 0) return; // suppress during pre-spawn phase
        if (rows === lastSentSize.rows && cols === lastSentSize.cols) return;
        if (Date.now() < resizeGraceUntil) return; // suppress during grace period
        // Debounce PTY IPC (not the visual fit) to avoid flooding with SIGWINCHes.
        if (ptyResizeTimer !== null) clearTimeout(ptyResizeTimer);
        ptyResizeTimer = setTimeout(() => {
          ptyResizeTimer = null;
          lastSentSize.rows = rows;
          lastSentSize.cols = cols;
          void resizePty(ptrRef.ptyId, rows, cols);
        }, 80);
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

      let lineBuffer = '';
      term.onData((data: string) => {
        if (ptrRef.ptyId > 0) void writeToPty(ptrRef.ptyId, data);
        if (data === '\r' || data === '\n') {
          const cmd = lineBuffer.trim();
          if (cmd) onCommandRef.current?.(cmd);
          lineBuffer = '';
        } else if (data === '\x7f' || data === '\b') {
          lineBuffer = lineBuffer.slice(0, -1);
        } else if (!data.startsWith('\x1b') && /^[\x20-\x7e]+$/.test(data)) {
          lineBuffer += data;
        }
      });

      // Wait for the terminal font to load before fitting. On first use, the
      // configured font may not be loaded yet — fitAddon.fit() would calculate
      // grid dimensions using a fallback font, and the later font-swap would
      // change cell metrics, causing a resize → SIGWINCH → prompt redraw.
      // Uses the same fontSize + fontFamily from the Terminal config above so
      // it adapts automatically if the user changes their font.
      const fontReady = document.fonts
        ? document.fonts.load(`${termFontSize}px ${termFontFamily}`)
        : Promise.resolve();
      void fontReady.then(() => {
        if (spawnCancelled) return;
        // Fit terminal to container to obtain exact grid dimensions.
        // onResize is suppressed here (ptrRef.ptyId <= 0 for spawn path;
        // for reconnect, the first real resize fires via onResize automatically).
        fitAddon.fit();
        startPtyConnection();
      });

      function startPtyConnection() {
        if (ptyId > 0) {
          // Reconnect: PTY already running in daemon (cold app restart).
          // Keep overlay until first scrollback byte to avoid empty-canvas flash.
          connectPtyOutput(ptyId, (data: Uint8Array) => {
            removeOverlay();
            term.write(data);
          });
          setCached(ptyId, term, fitAddon);
        } else {
          // Spawn: PTY started at exact fitted dimensions → lastSentSize = spawn dims
          // → dedup guard suppresses any subsequent fit at the same size → 0 SIGWINCH.
          void spawnTerminal(paneId, savedCwd, term.rows, term.cols).then(
            ({ ptyId: newId, isNew }) => {
              if (spawnCancelled) {
                // Component unmounted while spawn was in-flight. Don't close the
                // PTY — the daemon deduplicates by paneId, so a StrictMode remount
                // (or tab revisit) will reuse it. Orphan PTYs from true unmounts
                // are rare and can be cleaned up via the Session Manager.
                return;
              }
              ptrRef.ptyId = newId;
              lastSentSize.rows = term.rows;
              lastSentSize.cols = term.cols;

              // Grace period: suppress all resize IPC for 500ms so React re-renders
              // and layout settling don't send SIGWINCH during shell/Starship init.
              resizeGraceUntil = Date.now() + 500;

              if (isNew) {
                // Fresh shell: discard scrollback replay. Use debounced overlay
                // removal so the prompt output settles before revealing.
                connectPtyOutputFresh(newId, (data: Uint8Array) => {
                  debouncedRemoveOverlay();
                  term.write(data);
                });
              } else {
                // Restored session: remove overlay on first data byte (not immediately)
                // to avoid flashing a blank terminal when the shell hasn't output yet.
                connectPtyOutput(newId, (data: Uint8Array) => {
                  removeOverlay();
                  term.write(data);
                });
              }
              setCached(newId, term, fitAddon);
              onPtySpawned(newId);
              // No deferred resize here — the terminal was spawned at exact
              // container dimensions (after font load). Any layout shifts from
              // React re-renders are handled by ResizeObserver + onResize after
              // the grace period expires naturally. Sending an explicit resize
              // here was the remaining source of SIGWINCH that caused Starship
              // prompt flicker on the first two terminals.
            },
          );
        }
      }
    }

    termRef.current = term;

    // Immediate visual fit via rAF; PTY resize IPC is debounced in onResize above.
    if (term.element) term.element.style.background = themeBg;

    let resizeRaf: number | null = null;
    let resizingClassTimer: ReturnType<typeof setTimeout> | null = null;
    // ResizeObserver fires immediately (next frame) when observe() is called.
    // On that first observation, if the PTY is already connected (ptyId > 0), send
    // an unconditional resize IPC — this is the earliest reliable point after mount,
    // immune to the effect-cleanup cancellation that kills setTimeout-based polls
    // (onPtySpawned triggers a re-render → cleanup → clearTimeout before poll fires).
    let firstResizeSent = false;
    const resizeObserver = new ResizeObserver(() => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      if (!firstResizeSent && ptyId > 0) {
        firstResizeSent = true;
        fitAddon.fit();
        void resizePty(ptyId, term.rows, term.cols);
        return;
      }
      // Suppress CSS transitions during resize to avoid layout contention.
      document.body.classList.add('resizing');
      if (resizingClassTimer !== null) clearTimeout(resizingClassTimer);
      resizingClassTimer = setTimeout(() => {
        resizingClassTimer = null;
        document.body.classList.remove('resizing');
      }, 150);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        fitAddon.fit();
      });
    });
    resizeObserver.observe(container);

    if (isFocused) {
      term.focus();
    }

    return () => {
      spawnCancelled = true;
      removeOverlay();
      resizeObserver.disconnect();
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (resizingClassTimer !== null) clearTimeout(resizingClassTimer);
      document.body.classList.remove('resizing');
      if (ptyResizeTimer !== null) clearTimeout(ptyResizeTimer);
      // DON'T dispose term — just detach from container. Cache keeps it alive.
      const el = term.element;
      if (el && el.parentNode === container) {
        container.removeChild(el);
      }
    };
    // effectPtyId is a ref (stable identity) — intentionally excluded.
    // The spawn path manages the ptyId transition internally; only wasmReady
    // (and unmount/remount via containerRef) should trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, wasmReady]);

  return termRef;
}
