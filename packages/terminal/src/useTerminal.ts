import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getSettingCollection, getSetting } from '@canopy/db';
import { Terminal, FitAddon } from 'ghostty-web';

import { ensureGhosttyInit, isGhosttyReady } from './ghostty-init';
import { writeToPty, resizePty, connectPtyOutput, spawnTerminal } from './pty';
import { getCached, setCached } from './terminal-cache';
import { DEFAULT_TERMINAL_FONT_SIZE } from './terminal-font-size';
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
 * Overlay protocol
 * -----------------
 * spawn_terminal blocks on the Rust side until the sentinel frame is received
 * (end of scrollback replay). By the time invoke() resolves, the ChannelEntry
 * already holds the full scrollback.
 *
 * isNew=true (fresh shell): buffer is empty. Overlay is removed ~112ms after
 * the FIRST output byte (one-shot timer + double-rAF). The terminal continues
 * filling in while visible — looks responsive even if Starship is still emitting.
 *
 * isNew=false (restored session): Tauri Channel messages (scrollback) are queued
 * before the invoke response, so the buffer is populated when setHandler runs.
 * Overlay is removed synchronously — terminal already has content.
 */
// PTY IDs whose overlay hasn't been debounce-removed yet. When the effect
// re-runs on ptyId change (spawn → onPtySpawned → re-render), the cached
// path checks this set to decide whether to use the full debounce or the
// quick 2-rAF transition overlay.
const pendingOverlayPtyIds = new Set<number>();

const OVERLAY_QUIET_MS = 150;
const OVERLAY_MAX_MS = 800;

/** Create a debounced overlay remover: waits for output silence before revealing. */
function createOverlayDebounce(doRemove: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removed = false;
  let firstByteTime: number | null = null;

  return {
    /** Call on each output chunk to reset the quiet timer. */
    onOutput() {
      if (removed) return;
      const now = Date.now();
      if (firstByteTime === null) firstByteTime = now;
      if (now - firstByteTime >= OVERLAY_MAX_MS) {
        this.flush();
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        requestAnimationFrame(() => requestAnimationFrame(() => this.flush()));
      }, OVERLAY_QUIET_MS);
    },
    /** Immediately remove the overlay. Idempotent. */
    flush() {
      if (removed) return;
      removed = true;
      if (timer !== null) clearTimeout(timer);
      doRemove();
    },
  };
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  paneId: string,
  savedCwd: string | undefined,
  ptyId: number,
  isFocused: boolean,
  onPtySpawned: (id: number) => void,
  onCommand?: (cmd: string) => void,
  initialCommand?: string,
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

  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  // Synchronous resize before paint: when ptyId becomes a real pid (restored session
  // or pane remount), fire fitAddon.fit() + resizePty in the layout phase — before
  // the browser renders the first frame with the new ptyId.
  useLayoutEffect(() => {
    if (!wasmReady || ptyId <= 0) return;
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

    let spawnCancelled = false;
    let sigwinchTimer: ReturnType<typeof setTimeout> | null = null;
    let ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
    // Hoisted so cleanup can always call it (no-op for the cached path).
    let removeOverlay = () => {};
    const cached = getCached(ptyId);
    let term: Terminal;
    let fitAddon: FitAddon;

    // Establish a positioning context so absolute overlays/wrappers (inset:0)
    // resolve against container — not the outer relative ancestor.
    container.style.position = 'relative';

    // Reveal helper: double-rAF ensures ghostty-web's WASM renderer has painted
    // at least one frame before uncovering. Includes a re-fit so the terminal
    // has its final dimensions when revealed.
    function revealAfterPaint() {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fitAddon.fit();
          removeOverlay();
        }),
      );
    }

    if (cached) {
      // === CACHED PATH: remount after pane restructure — re-parent existing terminal ===
      term = cached.term;
      fitAddon = cached.fitAddon;

      // Overlay prevents ghosting (stale canvas visible for one frame before
      // ghostty-web repaints). It must be a sibling of el inside container, NOT
      // a child of el (term.element/wrapper): mutating el's children can trigger
      // ghostty-web's internal DOM observers and cause it to re-attach keyboard
      // listeners, producing visual duplication and double-typed characters.
      const transitionOverlay = document.createElement('div');
      transitionOverlay.style.cssText = `position:absolute;inset:0;background:${themeBg};z-index:1;pointer-events:none`;
      container.appendChild(transitionOverlay);
      removeOverlay = () => transitionOverlay.remove();

      const el = term.element;
      if (el) container.appendChild(el);

      fitAddon.fit();
      term.resume();
      void resizePty(ptyId, term.rows, term.cols);

      if (pendingOverlayPtyIds.has(ptyId)) {
        // Post-spawn re-run: shell is still initializing (Starship not done).
        // Use debounced overlay removal — wait for output to stabilize.
        pendingOverlayPtyIds.delete(ptyId);
        const debounce = createOverlayDebounce(() => transitionOverlay.remove());
        connectPtyOutput(ptyId, (data: Uint8Array) => {
          term.write(data);
          debounce.onOutput();
        });
      } else {
        // Genuine remount: terminal already has content, quick reveal.
        connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
        requestAnimationFrame(() => requestAnimationFrame(() => removeOverlay()));
      }
    } else {
      // === NEW TERMINAL: spawn (ptyId === -1) or reconnect (ptyId > 0) ===
      const termFontSize = getSetting<number>(
        getSettingCollection().toArray,
        'terminalFontSize',
        DEFAULT_TERMINAL_FONT_SIZE,
      );
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
        'position:absolute;inset:0;outline:none;padding:8px 0 8px 8px;margin:0;border:none';
      wrapper.style.background = themeBg;
      container.appendChild(wrapper);

      // Opaque overlay covering the canvas until the first LIVE PTY byte arrives.
      // MUST be appended BEFORE term.open() — ghostty's open() internally calls
      // renderer.render(), startRenderLoop(), and focus(), which paint the cursor
      // on the canvas immediately. Without the overlay already in place, the cursor
      // flashes for 1-2 frames before being covered.
      //
      // The overlay is removed on the first live byte from the shell (e.g. the
      // zsh prompt) — see overlayDebounce below.
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
          // Fade out over 80ms — masks sub-frame artifacts (clear→prompt gap,
          // async prompt stages, font swap from fallback to Geist Mono).
          overlay.style.transition = 'opacity 80ms ease-out';
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 80);
        }
      };
      // Debounced overlay removal: waits for output to stabilize (150ms of
      // silence) before revealing the terminal. This lets Starship finish
      // rewriting the prompt after zsh's initial PS1 draw. Hard cap at 800ms
      // prevents indefinite overlay on continuous output.
      const overlayDebounce = createOverlayDebounce(() => removeOverlay());

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
            const write = (seq: string) => {
              if (ptrRef.ptyId > 0) void writeToPty(ptrRef.ptyId, seq);
            };
            // macOS system shortcuts: stop ghostty-web from consuming them,
            // but do NOT preventDefault so the native menu handler fires.
            if (e.metaKey && 'qhm,'.includes(e.key)) {
              e.stopImmediatePropagation();
              return;
            }
            // Shift+Tab: ghostty-web sends \t (same as plain Tab) — send the correct backtab sequence.
            if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.stopImmediatePropagation();
              e.preventDefault();
              write('\x1b[Z');
              return;
            }
            // ghostty-web doesn't emit kitty keyboard protocol sequences for modified Enter.
            // Intercept so apps like Claude Code can distinguish Shift+Enter (newline) and
            // Ctrl+Enter from plain Enter.
            if (e.key === 'Enter' && !e.metaKey && !e.altKey) {
              if (e.shiftKey && !e.ctrlKey) {
                e.stopImmediatePropagation();
                e.preventDefault();
                write('\x1b[13;2u');
                return;
              }
              if (e.ctrlKey && !e.shiftKey) {
                e.stopImmediatePropagation();
                e.preventDefault();
                write('\x1b[13;5u');
                return;
              }
            }
            // Option+letter on macOS: the browser gives e.key = composed char (e.g. "†" for Option+T)
            // instead of e.key = "t" with altKey=true. The WASM encoder can't derive the base letter
            // from the non-ASCII key, so Alt sequences like \x1bt never reach the PTY.
            // Fix: use e.code ("KeyT") to recover the letter and send \x1b+letter directly.
            if (e.altKey && !e.metaKey && !e.ctrlKey && e.code.startsWith('Key')) {
              const letter = e.code.slice(3).toLowerCase();
              e.stopImmediatePropagation();
              e.preventDefault();
              write('\x1b' + letter);
              return;
            }
            // Option+ArrowLeft/Right: readline word-jump shortcuts (\x1bb / \x1bf).
            // The e.code.startsWith('Key') guard above misses arrow keys, so ghostty-web
            // never receives the correct Alt+Arrow sequence for word navigation.
            if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              if (e.key === 'ArrowLeft') {
                e.stopImmediatePropagation();
                e.preventDefault();
                write('\x1bb');
                return;
              }
              if (e.key === 'ArrowRight') {
                e.stopImmediatePropagation();
                e.preventDefault();
                write('\x1bf');
                return;
              }
            }
            if (e.repeat && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.stopImmediatePropagation();
              e.preventDefault();
              write(e.key);
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

      // Wait for the terminal font to load before fitting and connecting the PTY.
      // Without this gate, Ghostty renders with a fallback font (e.g. Menlo on macOS)
      // until Geist Mono is available, producing inconsistent text weight across
      // terminals. In practice this resolves immediately: __root.tsx preloads both
      // the regular and bold variants at module load time, so the font is warm before
      // any terminal mounts.
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
          // setHandler flushes buffered scrollback synchronously.
          // Defer reveal by one double-rAF so the container has its final
          // dimensions before we fit — otherwise the terminal shows with the
          // wrong column count until the next tab-switch triggers a re-fit.
          connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
          setCached(ptyId, term, fitAddon);
          revealAfterPaint();
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
                // Mark this ptyId so the cached-path re-run (triggered by
                // onPtySpawned → ptyId state change) uses debounced overlay
                // removal instead of the quick 2-rAF transition.
                pendingOverlayPtyIds.add(newId);
                connectPtyOutput(newId, (data: Uint8Array) => {
                  term.write(data);
                  overlayDebounce.onOutput();
                });
                if (initialCommand) {
                  void writeToPty(newId, initialCommand + '\r');
                }
              } else {
                // Reconnect: Tauri Channel messages are queued before the invoke
                // response, so the buffer is populated when setHandler is called.
                // setHandler flushes synchronously → overlay safe to remove.
                connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
                removeOverlay();
              }
              setCached(newId, term, fitAddon);
              onPtySpawned(newId);

              // Poll dimensions for 1s after spawn (every 200ms, up to 5 ticks).
              // Handles layout-settling races (sidebars, borders, split panes) and
              // ensures TUI apps like Claude Code fill the pane on first launch.
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
                } else if (ticks === 0) {
                  void resizePty(newId, r, c);
                }
                ticks++;
                if (ticks < 5) sigwinchTimer = setTimeout(poll, 200);
              };
              sigwinchTimer = setTimeout(poll, 100);
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
      // Clean up leaked entries if effect tears down before the cached-path re-run
      if (ptyId > 0) pendingOverlayPtyIds.delete(ptyId);
      resizeObserver.disconnect();
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (resizingClassTimer !== null) clearTimeout(resizingClassTimer);
      document.body.classList.remove('resizing');
      if (ptyResizeTimer !== null) clearTimeout(ptyResizeTimer);
      if (sigwinchTimer !== null) clearTimeout(sigwinchTimer);
      // DON'T dispose term — just detach from container. Cache keeps it alive
      // so the next mount can reparent the same element (preserving scrollback).
      // Suspend the render loop before detaching — the terminal stays alive in
      // cache but shouldn't keep running WebGL frames while off-screen.
      term.suspend();
      const el = term.element;
      if (el && el.parentNode === container) {
        container.removeChild(el);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ptyId, wasmReady]);

  return termRef;
}
