# @superagent/terminal

React hooks and utilities for Ghostty-web (WASM) terminal emulation connected to the PTY daemon via Tauri IPC.

## Main hook — `useTerminal`

```ts
const termRef = useTerminal({
  containerRef, // where to mount the terminal DOM
  paneId, // unique identifier for the pane
  savedCwd, // restore cwd on reconnect
  ptyId, // existing PTY to reconnect to (null = new spawn)
  isFocused, // forward keyboard events
  onPtySpawned, // (ptyId: number) => void — called once after spawn
  onCommand, // handle escape-sequence commands from the shell
});
```

**What it does:**

1. Ensures Ghostty WASM is initialized (`ensureGhosttyInit()`)
2. Fits the terminal to its container in a `useLayoutEffect` — **before** spawning the PTY so the daemon receives the correct grid size
3. Spawns or reconnects to a PTY via `spawnTerminal()`
4. Connects PTY output to the terminal renderer
5. Handles a brief overlay on fresh spawns (gives Starship time to emit its prompt)
6. Caches the terminal instance globally — the DOM is reparented across React re-renders rather than recreated

## PTY IPC (`pty.ts`)

Thin Tauri IPC wrappers. **All take `ptyId: number`**, not `paneId`:

```ts
spawnTerminal(paneId, cwd?, rows?, cols?)  // returns { ptyId, isNew }
connectPtyOutput(ptyId, handler)           // wire output; flushes scrollback on first call
writeToPty(ptyId, data)                    // string → bytes → invoke
resizePty(ptyId, rows, cols)
closePty(ptyId)
closePtysForPanes(paneIds)                 // bulk close orphaned sessions
getPtyCwd(ptyId)                           // get child process cwd — takes ptyId, NOT paneId
listPtySessions()                          // list all active sessions with CPU/mem stats
```

**Concurrent spawn dedup:** Multiple `spawnTerminal(paneId)` calls before any resolve share one IPC invoke. Safe to call from multiple React effects.

## Channel manager — two buffering modes

Output buffering is managed by `ChannelEntry`:

| Method               | Use case                                 | Scrollback                                   |
| -------------------- | ---------------------------------------- | -------------------------------------------- |
| `setHandler(h)`      | Fresh spawn or reconnect after remount   | Flushes buffered scrollback, then wires live |
| `setHandlerFresh(h)` | Cached terminal remount (DOM reparented) | Discards buffer, wires live only             |

Use `setHandlerFresh` when the terminal already has scrollback rendered — replaying it would duplicate output.

## Terminal cache

Terminal instances survive React tree restructuring (splits, close/reopen) by caching globally:

```ts
getCached(ptyId); // Terminal | undefined
setCached(ptyId, term, fitAddon);
disposeCached(ptyId); // call on closePty
getAllCached(); // for font-size changes
```

The DOM node is reparented to the new `containerRef` on remount — no re-render, no scrollback loss.

## Font size & themes

```ts
applyFontSizeToAll(size); // update all cached terminals + refit grids
DEFAULT_TERMINAL_FONT_SIZE; // = 13

terminalThemes; // Record<ThemeName, ITheme> — for ghostty-web
themeNames; // string[]
cssThemeProperties(name); // CSS vars for the app chrome matching the terminal palette
```

8 built-in dark themes: `carbon`, `graphite`, `obsidian`, `slate`, `midnight`, `void`, `smoke`, `ash`.

## Key constraints

- **Always fit before spawn.** `useLayoutEffect` runs before paint — the grid size must be sent to the daemon before `spawnTerminal()` is called.
- **`getPtyCwd` takes `ptyId`**, not `paneId`. The Rust command is keyed by PTY process ID.
- **Never call `setHandler` on a cached remount.** It replays scrollback that's already visible — use `setHandlerFresh`.
- **Overlay removal is async.** Fresh spawn overlays are removed after first output + two rAFs (~112 ms). Don't fight this timing.
