# Superagent

## What This Is

A desktop application for managing AI coding agents across git workspaces. Built with Tauri v2 (Rust backend + React frontend), it provides native terminal emulation, split pane management, git branch/worktree operations, and automatic agent detection — replacing the previous Superset.sh tool with a performant native app.

## Core Value

Developers can run and monitor multiple AI coding agents across workspaces from a single, fast native app with real terminals and git-native workflow support.

## Requirements

### Validated

- [x] Tauri v2 app shell with Rust backend and React frontend — Validated in Phase 01: app-shell-single-terminal
- [x] Real terminal via native PTY (portable-pty) + xterm.js (WebGL) — Validated in Phase 01: app-shell-single-terminal
- [x] macOS menu bar (About, Settings, Quit, standard Edit/Window) — Validated in Phase 01: app-shell-single-terminal

### Active

- [ ] Sidebar with workspace list, expand/collapse repos, branch/worktree icons (⎇/◆), agent status dots
- [x] Recursive split pane system (horizontal/vertical) with floating headers and drag handles — Validated in Phase 02: split-panes-keyboard
- [x] Tab bar with one tab per branch/worktree, agent status indicators — Validated in Phase 03: tabs-themes-statusbar
- [ ] Create branch/worktree center modal with type cards and git command preview
- [ ] Agent detection via process tree inspection (polling, configurable known_agents list)
- [ ] Agent waiting state: amber glow on pane/tab/sidebar, breathing animation
- [ ] Agent overview overlay (all agents across all workspaces)
- [ ] Toast notifications for cross-worktree agent events
- [ ] Settings: worktree location, default shell, theme, keybindings, known agents
- [x] 8 built-in dark themes via CSS custom properties — Validated in Phase 03: tabs-themes-statusbar
- [ ] Session persistence (layout, tabs, focused pane restored on reopen)
- [x] iTerm2-compatible keyboard shortcuts with user overrides — Validated in Phase 02: split-panes-keyboard
- [x] Status bar with repo info, agent summary, shortcut hints — Validated in Phase 03: tabs-themes-statusbar (pane count + hints; repo/agent info deferred to Phase 4/5)

### Out of Scope

- Theme customization UI — 8 built-in themes sufficient for v1
- Multi-agent orchestration dashboard — future capability
- Built-in diff viewer — use external tools
- IDE deep-linking — deferred
- Mixed content panes (non-terminal) — terminals only for v1
- Linux/Windows support — macOS only for v1
- Integration/E2E tests — unit tests only for v1
- Code signing — run unsigned for dev

## Context

- Replaces Superset.sh with a native desktop app
- Target users are developers running AI coding agents (Claude, Codex, Aider) across multiple repos and branches simultaneously
- Tauri v2 chosen for ~600KB binary, native WebKit, Rust backend performance
- React ARIA (Adobe) for accessible headless components, WAI-ARIA compliant
- xterm.js with WebGL addon for GPU-accelerated terminal rendering
- portable-pty for native PTY spawning, git2 for git ops without shelling out
- Bun as package manager, Vite as bundler, Oxlint/Oxfmt for TS tooling

## Constraints

- **Platform**: macOS only for v1 — Tauri supports cross-platform but scoping to one OS first
- **Tech stack**: Tauri v2 + React + TypeScript frontend, Rust backend — per design spec
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Components**: React ARIA (Adobe) headless primitives — accessibility-first
- **Terminal**: xterm.js (WebGL addon) + portable-pty — battle-tested, GPU-accelerated
- **Git**: git2 Rust crate — no shell exec for git operations
- **Testing**: Unit tests only (Vitest + React Testing Library for TS, Cargo test for Rust)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri v2 over Electron | ~600KB vs ~150MB, native WebKit, Rust backend for system ops | — Pending |
| React ARIA over Radix/shadcn | 40+ headless accessible primitives, WAI-ARIA compliant | — Pending |
| xterm.js over custom terminal | Battle-tested, WebGL GPU acceleration, large ecosystem | — Pending |
| portable-pty for PTY management | Native shell spawning via Rust, Tauri-native | — Pending |
| git2 over shell git | Branch/worktree ops without shelling out, type-safe | — Pending |
| Bun over npm/pnpm | Fast installs, native TS support, fast dev runtime | — Pending |
| Oxlint over ESLint | Rust-based, 50-100x faster linting | — Pending |
| Process polling (2s) for agent detection | Simple, reliable, configurable known_agents list | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-01 after Phase 03 completion*
