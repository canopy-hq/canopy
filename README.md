# Superagent

Monorepo for the Superagent desktop app.

## Dev Setup

### Prerequisites

- [Bun](https://bun.sh/) — package manager and runtime
- [Rust](https://rustup.rs/) — backend toolchain
- [sccache](https://github.com/mozilla/sccache) — shared Rust compilation cache (recommended)

```bash
brew install sccache
```

sccache is configured in `.cargo/config.toml` and caches compiled artifacts across git worktrees, cutting rebuild times by ~50%. No extra setup needed — Cargo picks it up automatically.

### macOS Keychain (code signing)

The app stores GitHub tokens in the macOS Keychain. Unsigned dev builds trigger a system permission prompt on every launch. To fix this, create a local self-signed code-signing certificate (one-time):

```bash
chmod +x scripts/setup-dev-codesign.sh scripts/cargo-codesign.sh
./scripts/setup-dev-codesign.sh
```

This creates a "Superagent Dev" certificate in your login keychain, trusted only for code signing — no impact on other apps. After setup, `bun run desktop:dev` automatically codesigns each build via `scripts/cargo-codesign.sh`.

## Commands

```bash
bun install                  # Install dependencies
bun run desktop:dev          # Start the app (auto-assigns port)
bun run desktop:build        # Build the app
```

### Multiple worktrees simultaneously

Each worktree picks a free port automatically. To pin a specific port:

```bash
VITE_PORT=1422 bun run desktop:dev
```

### Other commands

```bash
bun --filter desktop test              # Frontend tests (Vitest)
bun --filter @superagent/terminal test # Terminal package tests
cd apps/desktop/src-tauri && cargo test # Rust tests
bun run lint                           # Lint
bun run format                         # Format
```
