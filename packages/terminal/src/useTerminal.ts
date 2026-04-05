import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getSettingCollection, getSetting } from '@superagent/db';
import { Terminal, FitAddon } from 'ghostty-web';

import { ensureGhosttyInit, isGhosttyReady } from './ghostty-init';
import {
  writeToPty,
  resizePty,
  connectPtyOutput,
  spawnTerminal,
  claimWarmTerminal,
  getPoolStatus,
} from './pty';
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

    if (cached) {
      // === CACHED PATH: remount after pane restructure — re-parent existing terminal ===
      term = cached.term;
      fitAddon = cached.fitAddon;

      // Overlay prevents ghosting (stale canvas visible for one frame before
      // ghostty-web repaints). It must be a sibling of el inside container, NOT
      // a child of el (term.element/wrapper): mutating el's children can trigger
      // ghostty-web's internal DOM observers and cause it to re-attach keyboard
      // listeners, producing visual duplication and double-typed characters.
      // container.style.position = 'relative' establishes a positioning context so
      // that position:absolute;inset:0 on the overlay resolves against container.
      container.style.position = 'relative';
      const transitionOverlay = document.createElement('div');
      transitionOverlay.style.cssText = `position:absolute;inset:0;background:${themeBg};z-index:1;pointer-events:none`;
      container.appendChild(transitionOverlay);
      removeOverlay = () => transitionOverlay.remove();

      const el = term.element;
      if (el) container.appendChild(el);

      // connectPtyOutput: buffer is empty (handler was never cleared, data flowed
      // directly to term.write while tab was inactive), so flush is a no-op.
      // setHandlerFresh would be equivalent here, but connectPtyOutput is simpler.
      connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
      fitAddon.fit();
      // Unconditional resize IPC on cached remount — ptyId is the real pid,
      // proxy.sessions is already populated, so this call succeeds immediately.
      void resizePty(ptyId, term.rows, term.cols);
      // Double rAF: first rAF queues after current frame's layout, second fires
      // after ghostty-web's WASM renderer has completed at least one paint cycle.
      requestAnimationFrame(() => requestAnimationFrame(() => removeOverlay()));
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
        'position:absolute;inset:0;outline:none;padding:0;margin:0;border:none';
      wrapper.style.background = themeBg;
      container.appendChild(wrapper);

      // Opaque overlay covering the canvas until the first LIVE PTY byte arrives.
      // MUST be appended BEFORE term.open() — ghostty's open() internally calls
      // renderer.render(), startRenderLoop(), and focus(), which paint the cursor
      // on the canvas immediately. Without the overlay already in place, the cursor
      // flashes for 1-2 frames before being covered.
      //
      // The overlay is removed on the first live byte from the shell (e.g. the
      // zsh prompt) — see debouncedRemoveOverlay below.
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
      // One-shot overlay removal: schedule the timer on the FIRST byte only.
      // This reveals the terminal at first_byte+80ms+2×rAF (~112ms) regardless
      // of how long Starship keeps emitting — the canvas fills in while visible,
      // which looks responsive. The double-rAF ensures the WASM renderer has
      // painted at least one frame after the first write before uncovering.
      const debouncedRemoveOverlay = () => {
        if (overlayRemoved || overlayTimer !== null) return; // one-shot
        overlayTimer = setTimeout(() => {
          overlayTimer = null;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              removeOverlay();
            });
          });
        }, 80);
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
          // setHandler flushes buffered scrollback synchronously → overlay safe to
          // remove immediately after connectPtyOutput returns.
          connectPtyOutput(ptyId, (data: Uint8Array) => term.write(data));
          removeOverlay();
          setCached(ptyId, term, fitAddon);
        } else {
          // Try warm pool first, fall back to cold spawn.
          void (async () => {
            if (spawnCancelled) return;

            let result: { ptyId: number; isNew: boolean };
            let fromPool = false;

            try {
              // Race pool status against a tight timeout — if the daemon doesn't
              // support pool_status (old binary), send_cmd hangs forever with no
              // response. 200ms is generous for a local Unix socket round-trip.
              const status = await Promise.race([
                getPoolStatus(),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('pool_status timeout')), 200),
                ),
              ]);
              if (status.ready > 0) {
                result = await claimWarmTerminal(paneId, savedCwd, term.rows, term.cols);
                fromPool = true;
              } else {
                result = await spawnTerminal(paneId, savedCwd, term.rows, term.cols);
              }
            } catch {
              // Pool claim failed, pool_status timed out, or old daemon — fall back to cold spawn
              result = await spawnTerminal(paneId, savedCwd, term.rows, term.cols);
            }

            const { ptyId: newId, isNew } = result;

            if (spawnCancelled) return;
            ptrRef.ptyId = newId;
            lastSentSize.rows = term.rows;
            lastSentSize.cols = term.cols;
            resizeGraceUntil = Date.now() + 500;

            if (fromPool) {
              // Warm terminal: shell already booted, cd+clear already sent by daemon.
              // Connect output and remove overlay immediately — no waiting for first byte.
              connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
              removeOverlay();
            } else if (isNew) {
              connectPtyOutput(newId, (data: Uint8Array) => {
                debouncedRemoveOverlay();
                term.write(data);
              });
            } else {
              connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
              removeOverlay();
            }

            setCached(newId, term, fitAddon);
            onPtySpawned(newId);

            // Dimension polling (same as before)
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
          })();
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
      if (sigwinchTimer !== null) clearTimeout(sigwinchTimer);
      // DON'T dispose term — just detach from container. Cache keeps it alive
      // so the next mount can reparent the same element (preserving scrollback).
      const el = term.element;
      if (el && el.parentNode === container) {
        container.removeChild(el);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, ptyId, wasmReady]);

  return termRef;
}
