# Superagent

Desktop app for managing AI coding agents across git workspaces. Tauri v2 (Rust + React) with native terminals, git branch/worktree ops, and automatic agent detection.

**Core value:** Run and monitor multiple AI coding agents from a single native app — one window, real terminals, git-native.

## Stack

- **Platform:** macOS only (v1)
- **Shell:** Tauri v2 — Rust backend + React 19 frontend
- **Package manager:** Bun workspaces
- **Formatter/linter:** oxfmt + oxlint (run from root)

## Monorepo

| Package                     | Role                                                     |
| --------------------------- | -------------------------------------------------------- |
| `apps/desktop/src/`         | React frontend                                           |
| `apps/desktop/src-tauri/`   | Rust backend (git, PTY, agent detection)                 |
| `packages/ui/`              | Shared UI primitives (Kbd, …) — desktop + command-palette |
| `packages/db/`              | TanStack DB collections + Drizzle schema + SQLite        |
| `packages/terminal/`        | ghostty-web lifecycle, terminal cache, PTY IPC           |
| `packages/command-palette/` | Command menu — uses `@superagent/ui`                     |
| `packages/pty-daemon/`      | Standalone PTY daemon binary (unix socket, scrollback)   |
| `packages/tsconfig/`        | Shared TypeScript configs                                |

## Dev commands

See `README.md` for the full command reference (dev, build, release, DB reset).

## Key architectural rule

**Anything native, OS-level, or perf-critical must live in Rust** and be invoked via Tauri IPC. TypeScript handles UI logic only. See `apps/desktop/src-tauri/CLAUDE.md`.

## Sub-guides

- Frontend conventions → `apps/desktop/CLAUDE.md`
- Rust backend → `apps/desktop/src-tauri/CLAUDE.md`
- Shared UI primitives → `packages/ui/CLAUDE.md`
- Database & collections → `packages/db/CLAUDE.md`
- Terminal emulation & PTY IPC → `packages/terminal/CLAUDE.md`
- Command palette → `packages/command-palette/CLAUDE.md`
- PTY daemon (Rust binary) → `packages/pty-daemon/CLAUDE.md`
- FPS overlay (dev) → `packages/fps/CLAUDE.md`

## Git

Conventional commits: `feat(scope):`, `fix:`, `chore:`, `refactor:`, `test:`, `perf:`, `docs:`
