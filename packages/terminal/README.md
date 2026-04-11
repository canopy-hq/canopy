# @canopy/terminal

PTY management and terminal rendering for the Canopy desktop app.

Provides a React hook (`useTerminal`) and supporting modules for spawning, connecting, and rendering PTY sessions using [ghostty-web](https://github.com/ghostty-org/ghostty) (WASM-based terminal emulator) over Tauri v2 IPC.

---

## Architecture

```
useTerminal (hook)
  ├── ghostty-init   — lazy WASM init singleton
  ├── pty            — Tauri IPC: spawn / connect / write / resize / close / getCwd
  │     └── channel-manager  — sentinel-aware output state machine
  ├── terminal-cache — global Terminal + FitAddon cache, survives React remounts
  └── themes         — 8 dark themes (CSS props + terminal color schemes)
```

### 3-phase PTY protocol

Every `attach` call from the daemon sends output in three phases:

```
┌─────────────────────┬───────────┬──────────────────┐
│  Scrollback replay  │ Sentinel  │   Live data       │
│  (accumulated hist) │ ([] frame)│   (fresh shell)   │
└─────────────────────┴───────────┴──────────────────┘
       Phase 1             Phase 2       Phase 3
```

- **Phase 1** — Buffered history. May be large (e.g. a previous Claude Code session).
- **Phase 2** — A zero-length frame (`rawData.length === 0`) marking "end of replay".
- **Phase 3** — Fresh PTY output from the running shell.

The `channel-manager` state machine separates these phases so the overlay is only removed on the first **live** byte, never on stale scrollback.

### Two wiring modes

| Mode            | API                  | When to use                                                                                              |
| --------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| **Reconnect**   | `setHandler(h)`      | Cold restart — user wants to see their previous session. Flushes scrollback immediately.                 |
| **Fresh spawn** | `setHandlerFresh(h)` | New PTY — discard all pre-sentinel data, forward only live bytes. Keeps overlay until first real prompt. |

### Overlay mechanism

For new spawns, an opaque overlay (matching the terminal background color) covers the canvas until `connectPtyOutputFresh`'s handler receives the first post-sentinel byte. This prevents flickering ghostly scrollback before the shell prompt appears.

### Terminal cache

Terminal instances are expensive to create (WASM heap allocation). When a pane is restructured (split/close), React unmounts and remounts the component. To preserve scrollback across remounts, every Terminal + FitAddon pair is stored in a global `Map<ptyId, CachedEntry>`. On remount, the existing element is re-parented into the new container — no reset, no replay, identical visual state.

---

## Public API

### `useTerminal`

```ts
useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  paneId:       string,
  savedCwd:     string | undefined,
  ptyId:        number,           // -1 to spawn new PTY, >0 to reconnect
  isFocused:    boolean,
  onPtySpawned: (id: number) => void,
): React.MutableRefObject<Terminal | null>
```

### PTY functions (`pty.ts`)

| Function                                    | Description                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `spawnTerminal(paneId, cwd?, rows?, cols?)` | Spawn a new PTY; returns `ptyId`.                                 |
| `connectPtyOutput(ptyId, handler)`          | Wire handler, flush scrollback (reconnect path).                  |
| `connectPtyOutputFresh(ptyId, handler)`     | Wire handler, discard scrollback, wait for sentinel (spawn path). |
| `writeToPty(ptyId, data)`                   | Send string data to the PTY.                                      |
| `resizePty(ptyId, rows, cols)`              | Resize the PTY grid.                                              |
| `closePty(ptyId)`                           | Close PTY and remove from registry.                               |
| `getPtyCwd(ptyId)`                          | Get the current working directory of the PTY process.             |

### Terminal cache (`terminal-cache.ts`)

| Function                           | Description                                   |
| ---------------------------------- | --------------------------------------------- |
| `getCached(ptyId)`                 | Retrieve `{ term, fitAddon }` or `undefined`. |
| `setCached(ptyId, term, fitAddon)` | Store (or overwrite) a cache entry.           |
| `disposeCached(ptyId)`             | Call `term.dispose()` and remove entry.       |
| `getAllCached()`                   | Return the live cache `Map` (read-only).      |

### Themes (`themes.ts`)

| Export               | Type                                     | Description                      |
| -------------------- | ---------------------------------------- | -------------------------------- |
| `themes`             | `Record<ThemeName, ThemeDefinition>`     | Full theme definitions.          |
| `themeNames`         | `ThemeName[]`                            | Array of all theme name strings. |
| `terminalThemes`     | `Record<ThemeName, TerminalThemeColors>` | Terminal color schemes only.     |
| `cssThemeProperties` | `Record<ThemeName, CssThemeProperties>`  | CSS custom property values only. |

### `ensureGhosttyInit`

```ts
ensureGhosttyInit(): Promise<void>
```

Lazy singleton — initializes the ghostty-web WASM module once. Subsequent calls return the cached promise.

---

## Themes

Eight dark themes, each defining CSS custom properties and ANSI terminal colors:

| Name       | Accent              | Character                     |
| ---------- | ------------------- | ----------------------------- |
| `obsidian` | Blue (`#3b82f6`)    | Deep blue-black (**default**) |
| `carbon`   | Amber (`#d97706`)   | Warm neutral                  |
| `graphite` | Violet (`#8b5cf6`)  | Cool gray                     |
| `slate`    | Sky (`#38bdf8`)     | Blue-gray                     |
| `midnight` | Indigo (`#6366f1`)  | Deep navy                     |
| `void`     | Purple (`#a855f7`)  | Near-pure black               |
| `smoke`    | Amber (`#f59e0b`)   | Warm brown-gray               |
| `ash`      | Emerald (`#10b981`) | Desaturated cool-green        |

---

## Development

### Running tests

```bash
cd packages/terminal
bun run test
```

### Running benchmarks

```bash
cd packages/terminal
bun run bench
```

Benchmarks cover channel-manager throughput (1 B / 1 KB / 64 KB / 1 MB payloads), scrollback flush latency, terminal-cache map operations, and theme lookup baseline.

### Adding a new theme

1. Add the theme name to the `ThemeName` union in `src/themes.ts`.
2. Add a `ThemeDefinition` entry to the `themes` object — fill in all `CssThemeProperties` and `TerminalThemeColors` fields.
3. The `themeNames`, `terminalThemes`, and `cssThemeProperties` exports are derived automatically.
4. Run `bun run test` — the themes tests will verify completeness.
