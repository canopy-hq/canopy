# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project

**Superagent** — Desktop app for managing AI coding agents across git workspaces. Tauri v2 (Rust backend + React frontend) with native terminals, split panes, git branch/worktree ops, and automatic agent detection.

**Core Value:** Run and monitor multiple AI coding agents across workspaces from a single, fast native app with real terminals and git-native workflow support.

### Constraints

- **Platform**: macOS only (v1)
- **Tech stack**: Tauri v2 + React 19 + TypeScript, Rust backend
- **Styling**: Tailwind CSS v4 with CSS custom properties for theming
- **Components**: React ARIA (Adobe) headless primitives — accessibility-first
- **Terminal**: ghostty-web (WASM Ghostty) + portable-pty via standalone daemon process
- **Git**: git2 Rust crate — no shell exec
- **State**: @tanstack/db collections (in-memory + SQLite persistence via drizzle-orm)
- **Routing**: TanStack Router (file-based routes in `src/routes/`)
- **Testing**: Unit tests only (Vitest + RTL for TS, cargo test for Rust)
- **Package manager**: Bun workspaces

## Development Commands

```bash
bun install                                          # install deps
bun run desktop:dev                                  # dev server (auto-assigns port, supports parallel worktrees)
bun run desktop:build                                # production binary
bun --filter desktop run test                        # frontend tests (vitest)
bun --filter @superagent/terminal run test           # terminal package tests
cd apps/desktop/src-tauri && cargo test              # rust tests
bun run lint                                         # oxlint (root)
bun run format                                       # oxfmt (root)
```

## Monorepo Structure

Bun workspaces. Rust workspace for backend crates.

| Package | Purpose |
|---------|---------|
| `apps/desktop/src/` | React frontend (components, hooks, lib, routes) |
| `apps/desktop/src-tauri/` | Rust backend (git, PTY, agent detection) |
| `packages/db/` | TanStack DB collections + Drizzle schema + SQLite persistence |
| `packages/terminal/` | ghostty-web lifecycle, terminal cache, themes, PTY IPC |
| `packages/pty-daemon/` | Standalone PTY daemon binary (unix socket, scrollback) |
| `packages/tsconfig/` | Shared TypeScript configs |

## Architecture

### Data flow

```
React components
  ↕ useLiveQuery (reactive)
TanStack DB collections (in-memory)
  ↕ write-through
SQLite via drizzle-orm + @tauri-apps/plugin-sql
```

### Backend

See [`apps/desktop/src-tauri/BACKEND.md`](apps/desktop/src-tauri/BACKEND.md) for Rust modules, PTY daemon, IPC patterns, and backend performance rules.

### Frontend

See [`apps/desktop/FRONTEND.md`](apps/desktop/FRONTEND.md) for styling conventions, `tv()` variants, React ARIA data-attributes, and CSS custom properties.

### Frontend layers

| Layer | Pattern |
|-------|---------|
| **Collections** (`packages/db/collections/`) | Module-level singletons. Persisted collections write-through to SQLite. In-memory collections for ephemeral state (agents, UI). |
| **Hooks** (`src/hooks/`) | `useCollections.ts` wraps `useLiveQuery` for reactive reads. `useWorkspacePolling` does adaptive polling with visibility gating. |
| **Lib** (`src/lib/`) | Imperative action functions. Read state via `getUiState()`/`getTabCollection()` (non-reactive). Mutate collections directly. `git.ts` wraps Tauri `invoke()` with types. |
| **Components** (`src/components/`) | Leaf components. `WorkspaceTree` uses `React.memo` + custom comparators for tree rows. |
| **Routes** (`src/routes/`) | TanStack Router file-based. `__root.tsx` handles boot + global listeners. |

## Performance

**Superagent must feel as fast as Linear. Design for 40 workspaces x 50 branches = 2000 items.**

### React rendering

- **Memoize list items.** Always wrap leaf display components with `React.memo` + custom comparators when they appear in lists or trees. The sidebar tree has 500+ nodes — every unnecessary re-render matters.
- **Stabilize callbacks.** `useCallback` for any function passed to memoized children.
- **No allocations in selectors.** Never use `filter()`, `map()`, or object spread in TanStack DB selectors — creates new references every render, causing infinite re-renders.

### Polling

- **Visibility-gated.** All polling must pause when sidebar hidden (`sidebarVisible`) AND when window hidden (`document.visibilityState`).
- **Scope to visible data.** Only poll for expanded workspaces; carry forward stale data for collapsed ones.
- **Adaptive intervals.** Start at 3s, back off to 10s after 5 unchanged polls, 15s after 10. Reset on change detection.
- **Shallow comparison.** Never use `JSON.stringify` for deep equality — use shallow key/value comparison or refs.

### State

- **No mutation flags in updaters.** React state updaters may run asynchronously in concurrent mode. Never read a mutation flag set inside a state updater outside of it. Use refs for previous-state comparison.

### Memory

- **Clean up on close.** Remove stale entries when workspaces are closed.
- **Carry forward invisible data.** Don't re-fetch stats for collapsed workspaces — use the last known values.

### Scale testing

- Profile the "40 workspaces expanded" scenario before shipping any polling feature.
- Every polling hook, IPC call, and React render must be evaluated at 2000-item scale.

## Conventions

### Component patterns

- **`React.memo` + custom comparators** for all leaf components in lists/trees (see `WorkspaceTree.tsx` for pattern: compare only props that affect rendering)
- **Function components only** — no class components
- **`createPortal(document.body)`** for modals and command palettes
- **`data-tauri-drag-region`** on header elements for native window dragging

### State management

- **TanStack DB collections** are module-level singletons — access via `getXxxCollection()` getters
- **Reactive reads**: `useLiveQuery(() => collection)` via `useCollections.ts` hooks
- **Imperative reads** (in action functions): `getUiState()`, `getTabCollection()` — non-reactive, no re-renders
- **Dual-write UI state**: navigation state (`activeTabId`, `sidebarVisible`, etc.) written to both `uiCollection` (in-memory) and `settingCollection` (persisted) on every change
- **`workspaceItemId` composite keys**: `ws.id` for repo root, `ws.id-branch-{name}` for branches, `ws.id-wt-{name}` for worktrees

### Testing

- **TypeScript**: Vitest + RTL. `vi.mock()` for Tauri modules. Pure logic tests (pane-tree-ops, tab-actions) need no mocks.
- **Rust**: See [BACKEND.md](apps/desktop/src-tauri/BACKEND.md#testing).
- **Terminal package**: separate vitest config with happy-dom. `test/__mocks__/` dir for ghostty-web, db, tauri-apps.

### Git conventions

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `build:`, `ci:`, `perf:` with optional scope
- Example: `feat(sidebar): add diff stats to branch rows`
