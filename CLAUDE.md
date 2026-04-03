# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
bun --filter desktop tauri dev                       # dev server
bun --filter desktop run test                        # frontend tests (vitest)
bun --filter @superagent/terminal run test           # terminal package tests
cd apps/desktop/src-tauri && cargo test              # rust tests
bun --filter desktop tauri build                     # production binary
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

### Rust backend

| Module | Responsibility |
|--------|---------------|
| `git.rs` | All git2 ops: branches, worktrees, diff stats. `spawn_blocking` + `Semaphore(6)` for async. Batch variant `get_all_diff_stats` for N repos in one call. |
| `pty.rs` | Bridges daemon client + agent watcher. `spawn_terminal` → daemon spawn → attach Channel → start agent watcher. |
| `agent_watcher.rs` | libproc process-tree walk. Known agents: claude, codex, aider, gemini. 250ms poll, emits `agent-status-changed` events on state change only. |
| `daemon_client.rs` | Unix socket client for pty-daemon. Fresh connection per request (spawn/close), persistent connection for fire-and-forget (write/resize). |
| `lib.rs` | Tauri setup: plugins, menu, daemon lifecycle, window hide-on-close (PTY sessions survive). |

### PTY daemon (separate process)

Standalone binary (`superagent-pty-daemon`) in own process group — survives app restart. Protocol: newline-delimited JSON commands, binary framed output. Scrollback: 100KB ring-buffer replayed on attach.

### Frontend layers

| Layer | Pattern |
|-------|---------|
| **Collections** (`packages/db/collections/`) | Module-level singletons. Persisted collections write-through to SQLite. In-memory collections for ephemeral state (agents, UI). |
| **Hooks** (`src/hooks/`) | `useCollections.ts` wraps `useLiveQuery` for reactive reads. `useDiffStatsMap` does adaptive polling with visibility gating. |
| **Lib** (`src/lib/`) | Imperative action functions. Read state via `getUiState()`/`getTabCollection()` (non-reactive). Mutate collections directly. `git.ts` wraps Tauri `invoke()` with types. |
| **Components** (`src/components/`) | Leaf components. `WorkspaceTree` uses `React.memo` + custom comparators for tree rows. |
| **Routes** (`src/routes/`) | TanStack Router file-based. `__root.tsx` handles boot + global listeners. |

### IPC pattern

TypeScript → `invoke<T>('command_name', { args })` → Rust `#[tauri::command]` → `spawn_blocking` for git2/IO → serialize result → TypeScript.

Events (agent status): Rust `app_handle.emit('event', payload)` → TypeScript `listen('event', callback)`.

## Performance

**Superagent must feel as fast as Linear. Design for 40 workspaces x 50 branches = 2000 items.**

### IPC

- **Batch, never loop.** Never fire N individual IPC calls when one batched call works. Always provide batch variants for commands called in loops (e.g., `get_all_diff_stats` not N x `get_diff_stats`).
- **Cap concurrency.** Use `tokio::sync::Semaphore` to limit concurrent `spawn_blocking` tasks (max 6-8). Never let 40 blocking tasks run simultaneously.
- **Filter on Rust side.** Drop zero/empty results before serializing — don't send data the frontend will discard.

### React rendering

- **Memoize list items.** Always wrap leaf display components with `React.memo` + custom comparators when they appear in lists or trees. The sidebar tree has 500+ nodes — every unnecessary re-render matters.
- **Stabilize callbacks.** `useCallback` for any function passed to memoized children.
- **No allocations in selectors.** Never use `filter()`, `map()`, or object spread in Zustand/TanStack DB selectors — creates new references every render, causing infinite re-renders.

### Polling

- **Visibility-gated.** All polling must pause when sidebar hidden (`sidebarVisible`) AND when window hidden (`document.visibilityState`).
- **Scope to visible data.** Only poll for expanded workspaces; carry forward stale data for collapsed ones.
- **Adaptive intervals.** Start at 10s, back off to 20s after 3 unchanged polls, 30s after 6. Reset on change detection.
- **Shallow comparison.** Never use `JSON.stringify` for deep equality — use shallow key/value comparison or refs.

### Rust backend

- **`git2::Repository` is `!Send`.** Never cache or share across threads. Open fresh per operation inside `spawn_blocking`.
- **Always `spawn_blocking` for git2.** All git2 operations block on disk I/O.
- **Filter before serialize.** Drop empty/zero results before sending over IPC.

### State

- **No mutation flags in updaters.** React state updaters may run asynchronously in concurrent mode. Never read a mutation flag set inside a state updater outside of it. Use refs for previous-state comparison.

### Memory

- **Clean up on close.** Remove stale entries when workspaces are closed.
- **Carry forward invisible data.** Don't re-fetch stats for collapsed workspaces — use the last known values.

### Scale testing

- Profile the "40 workspaces expanded" scenario before shipping any polling feature.
- Every polling hook, IPC call, and React render must be evaluated at 2000-item scale.

## Conventions

### Frontend styling

See [`apps/desktop/FRONTEND.md`](apps/desktop/FRONTEND.md) for full rules. Summary:

- **Tailwind-first**: `style={{}}` only for CSS variable injection or vendor-prefixed properties
- **`tv()` for variants**: `tailwind-variants` for all conditional class logic — no ternary class strings
- **React ARIA data-attributes**: `data-[selected]:`, `data-[focused]:`, etc. — no render-prop `className` functions
- **CSS custom properties**: theming tokens only in `@theme {}` block — use Tailwind classes (`bg-bg-primary`) not `var()` in styles

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

### IPC

- TypeScript wrappers in `lib/git.ts` — thin typed `invoke<T>()` calls
- Rust commands: `#[tauri::command]` with `spawn_blocking` for all git2/IO ops
- Events for push-based data (agent status): Rust `emit()` → TS `listen()`
- `#[serde(rename_all = "camelCase")]` on all Rust structs crossing IPC boundary

### Testing

- **TypeScript**: Vitest + RTL. `vi.mock()` for Tauri modules. Pure logic tests (pane-tree-ops, tab-actions) need no mocks.
- **Rust**: inline `#[cfg(test)]` modules. `tempfile::TempDir` for git repos. `#[tokio::test]` for async commands.
- **Terminal package**: separate vitest config with happy-dom. `__mocks__/` dir for ghostty-web, db, tauri-apps.

### File organization

- `hooks/` — React hooks only (reactive reads, polling, DOM events)
- `lib/` — imperative action functions + IPC wrappers (no React, no hooks)
- `components/` — display components (read from hooks, call lib functions)
- `routes/` — TanStack Router pages (compose components, bind keyboard shortcuts)
- `packages/db/collections/` — state definitions + persistence logic
- `packages/terminal/` — terminal lifecycle (useTerminal hook, cache, themes, PTY IPC)

### Git conventions

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `build:`, `ci:`, `perf:` with optional scope
- Example: `feat(sidebar): add diff stats to branch rows`
