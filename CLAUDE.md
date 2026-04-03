<!-- GSD:project-start source:PROJECT.md -->
## Project

**Superagent**

A desktop application for managing AI coding agents across git workspaces. Built with Tauri v2 (Rust backend + React frontend), it provides native terminal emulation, split pane management, git branch/worktree operations, and automatic agent detection — replacing the previous Superset.sh tool with a performant native app.

**Core Value:** Developers can run and monitor multiple AI coding agents across workspaces from a single, fast native app with real terminals and git-native workflow support.

### Constraints

- **Platform**: macOS only for v1 — Tauri supports cross-platform but scoping to one OS first
- **Tech stack**: Tauri v2 + React + TypeScript frontend, Rust backend — per design spec
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Components**: React ARIA (Adobe) headless primitives — accessibility-first
- **Terminal**: ghostty-web (WASM-based Ghostty terminal) + portable-pty — battle-tested Zig parser, proper Unicode
- **Git**: git2 Rust crate — no shell exec for git operations
- **Testing**: Unit tests only (Vitest + React Testing Library for TS, Cargo test for Rust)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Framework
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tauri | 2.10.3 | App shell, Rust backend, WebKit frontend | ~600KB binary, native perf, Rust backend for PTY/git/process ops. Mature (2.10.x). | HIGH |
| React | 19.2.4 | UI framework | Stable, massive ecosystem, React ARIA built on it. 19.x adds Activity component useful for prerendering hidden panes. | HIGH |
| TypeScript | 5.x | Type safety | Standard. Do NOT jump to TS 6.0 yet (breaking migration). | HIGH |
### Terminal & PTY
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ghostty-web | 0.4.0 | Terminal rendering | WASM-compiled Ghostty parser (Zig). xterm.js-compatible API, proper Unicode/complex script support, zero transitive deps. Canvas2D renderer with dirty-row tracking. | HIGH |
| portable-pty | 0.9.0 | Native PTY spawning (Rust) | Battle-tested (powers WezTerm). Direct control over shell lifecycle. | HIGH |
### Git Operations
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| git2 | 0.20.4 | Git branch/worktree operations | Rust-native libgit2 bindings. Thread-safe, memory-safe. No shell exec. Worktree support via `Repository::worktrees()`. | HIGH |
### Process Detection (Agent Detection)
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| sysinfo | latest (0.33+) | Process tree inspection | Cross-platform process enumeration. Filter by name against known_agents list. 2s polling interval. | HIGH |
### State Management
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zustand | 5.x | Frontend state (layout, tabs, panes, agent status) | 3KB, works outside React (useful for Tauri IPC handlers), simple store model fits our needs. Jotai's atomic model is overkill here. | HIGH |
| tauri-plugin-store | 2.4.2 | Persistent settings (JSON on disk) | Official Tauri plugin. Auto-saves. Key-value store for user preferences, session layout, known_agents. | HIGH |
### UI Components & Styling
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| react-aria-components | 1.16.0 | Headless accessible UI primitives | 50+ components, WAI-ARIA compliant, unstyled (we own the look). Adobe-backed, actively maintained. | HIGH |
| tailwindcss-react-aria-components | 2.x | Tailwind plugin for RAC state selectors | Enables `data-[state]:` style variants for RAC components. Works with Tailwind v4 via `@plugin` import. | MEDIUM |
| Tailwind CSS | 4.2.2 | Utility-first styling | v4 engine: 5x faster builds, 100x faster incremental. CSS custom properties for theming. Zero-config with Vite plugin. | HIGH |
### Build & Dev Tools
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vite | 8.0.3 | Bundler & dev server | Rolldown-based (Rust bundler), 10-30x faster builds. First-class Tauri support. | HIGH |
| Bun | 1.3.11 | Package manager & runtime | 4-6x faster installs than npm. Used by Anthropic for Claude Code. Mature enough for package management. | MEDIUM |
| Oxlint | 1.58.0 | Linting | 50-100x faster than ESLint. 700+ rules. JS plugin support in alpha. | HIGH |
| Oxfmt | 0.42.0 (beta) | Code formatting | 30x faster than Prettier. 100% Prettier JS/TS conformance. Beta but stable for JS/TS. | MEDIUM |
### Testing
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | 4.1.2 | Frontend unit tests | Vite-native, Vite 8 support. Fast, good DX. | HIGH |
| @testing-library/react | latest | Component testing | Standard React testing. Pairs with Vitest. | HIGH |
| cargo test | (built-in) | Rust unit tests | Standard Rust testing. No extra deps needed. | HIGH |
### Rust Dependencies (Cargo.toml)
| Crate | Version | Purpose | Confidence |
|-------|---------|---------|------------|
| tauri | 2.10 | App framework | HIGH |
| tauri-plugin-store | 2.4 | Settings persistence | HIGH |
| portable-pty | 0.9 | PTY management | HIGH |
| git2 | 0.20 | Git operations | HIGH |
| sysinfo | 0.33+ | Process detection | HIGH |
| serde | 1.x | Serialization (Tauri IPC) | HIGH |
| serde_json | 1.x | JSON serialization | HIGH |
| tokio | 1.x | Async runtime (Tauri default) | HIGH |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| PTY | portable-pty (direct) | tauri-plugin-pty 0.1.1 | Too immature (v0.1.x), limits PTY lifecycle control needed for multi-terminal |
| State | Zustand | Jotai | Atomic model unnecessary; need outside-React access for IPC handlers |
| State | Zustand | Redux Toolkit | Overkill boilerplate for desktop app state |
| Terminal | xterm.js 6 | xterm.js 5 | v5 is 3 years old; v6 removes deprecated canvas, improves scrollbar |
| Linter | Oxlint | ESLint | 50-100x slower, Oxlint covers same rules |
| Formatter | Oxfmt | Prettier | 30x slower, Oxfmt has 100% Prettier conformance |
| Formatter | Oxfmt | Biome | Oxfmt 3x faster than Biome, better Prettier compat |
| Bundler | Vite 8 | Webpack | No contest for DX/speed in 2026 |
| Pkg manager | Bun | pnpm | Bun faster; pnpm is safe fallback if Bun hits native dep issues |
| Components | React ARIA | Radix UI | React ARIA has 50+ components vs Radix's fewer; Adobe backing; better a11y compliance |
| Components | React ARIA | shadcn/ui | shadcn is pre-styled (we want headless + custom themes) |
| Git | git2 | Command::new("git") | Shell exec is slower, harder to handle errors, no type safety |
| Process info | sysinfo | procfs/libproc | sysinfo is cross-platform, well-maintained, simpler API |
## xterm.js 6.0 Migration Notes
- **Canvas renderer removed** -- WebGL is the only GPU renderer now (this is what we want)
- **Scrollbar reworked** -- viewport/scroll behavior changed; test thoroughly
- **EventEmitter removed** -- uses `vs/base/common/event` Emitter pattern
- **Package scope**: Use `@xterm/xterm` and `@xterm/addon-*` (not old `xterm` package)
## Monorepo Structure

Bun workspaces monorepo. The desktop app lives under `apps/desktop/`.

```
superagent/
├── package.json          # root workspace config
├── apps/
│   └── desktop/          # Tauri + React app
│       ├── package.json
│       ├── src/           # React frontend
│       ├── src-tauri/     # Rust backend
│       ├── vite.config.ts
│       └── vitest.config.ts
└── packages/
    └── tsconfig/         # shared TS config
```

## Development Commands

All commands run from repo root unless noted.

```bash
# Install dependencies
bun install

# Dev server (from apps/desktop)
cd apps/desktop && bun tauri dev

# Frontend tests
cd apps/desktop && bun run test

# Rust tests
cd apps/desktop/src-tauri && cargo test

# Build production binary
cd apps/desktop && bun tauri build
```

## Installation
# Rust deps in apps/desktop/src-tauri/Cargo.toml
# tauri = "2.10"
# tauri-plugin-store = "2.4"
# portable-pty = "0.9"
# git2 = "0.20"
# sysinfo = "0.33"
# serde = { version = "1", features = ["derive"] }
# serde_json = "1"
# tokio = { version = "1", features = ["full"] }
## Tauri v2 IPC Pattern
## Version Pinning Strategy
- Tauri: `~2.10` (stay on 2.x, accept patches)
- xterm.js: `~6.0` (new major, be cautious with minors)
- React: `~19.2` (stable line)
- Vite: `~8.0` (new major with Rolldown, watch for edge cases)
## Sources
- [Tauri 2.10.3 on docs.rs](https://docs.rs/crate/tauri/latest)
- [Tauri v2 releases](https://v2.tauri.app/release/)
- [xterm.js releases](https://github.com/xtermjs/xterm.js/releases)
- [@xterm/addon-webgl on npm](https://www.npmjs.com/package/@xterm/addon-webgl)
- [portable-pty on crates.io](https://crates.io/crates/portable-pty)
- [git2 on crates.io](https://crates.io/crates/git2)
- [sysinfo on crates.io](https://crates.io/crates/sysinfo)
- [React ARIA Components](https://react-aria.adobe.com/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Vite 8 announcement](https://vite.dev/blog/announcing-vite8)
- [Oxlint docs](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxfmt beta announcement](https://oxc.rs/blog/2026-02-24-oxfmt-beta)
- [Vitest 4](https://vitest.dev/blog/vitest-4)
- [Zustand on npm](https://www.npmjs.com/package/zustand)
- [tauri-plugin-store](https://v2.tauri.app/plugin/store/)
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)
- [Bun package manager](https://bun.sh/package-manager)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

### Frontend Styling

See [`apps/desktop/FRONTEND.md`](apps/desktop/FRONTEND.md) for full details.

- **Tailwind-first**: utility classes by default, inline `style={{}}` only for truly dynamic runtime values
- **`tv()` for variants**: use `tailwind-variants` for all conditional class logic — no manual template literal ternaries
- **React ARIA data-attributes**: use `data-[selected]:`, `data-[focused]:`, etc. via the `tailwindcss-react-aria-components` plugin — no render-prop `className` functions
- **CSS custom properties**: theming tokens only, defined in `@theme {}` block — use Tailwind classes (`bg-bg-primary`) not `var(--bg-primary)` in styles
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
