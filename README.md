# Canopy

[![CI](https://github.com/nept/superagent/actions/workflows/ci.yml/badge.svg)](https://github.com/nept/superagent/actions/workflows/ci.yml)

Monorepo for the Canopy desktop app.

## Dev Setup

### Prerequisites

- [Bun](https://bun.sh/) — package manager and runtime
- [Rust](https://rustup.rs/) — backend toolchain
- [sccache](https://github.com/mozilla/sccache) — shared Rust compilation cache (recommended)

```bash
brew install sccache
```

### GitHub Package Registry

`ghostty-web` is hosted on GitHub Package Registry, which requires authentication even for public packages. Before running `bun install`, export a GitHub personal access token with the `read:packages` scope:

```bash
export GITHUB_TOKEN=your_token_here
```

To generate a token: GitHub → Settings → Developer settings → Personal access tokens → New token → select `read:packages`.

sccache is configured in `.cargo/config.toml` and caches compiled artifacts across git worktrees, cutting rebuild times by ~50%. No extra setup needed — Cargo picks it up automatically.

### macOS Keychain (code signing)

The app stores GitHub tokens in the macOS Keychain. Unsigned dev builds trigger a system permission prompt on every launch. To fix this, create a local self-signed code-signing certificate (one-time):

```bash
chmod +x scripts/setup-dev-codesign.sh scripts/cargo-codesign.sh
./scripts/setup-dev-codesign.sh
```

This creates a "Canopy Dev" certificate in your login keychain, trusted only for code signing — no impact on other apps. After setup, `bun run desktop:dev` automatically codesigns each build via `scripts/cargo-codesign.sh`.

## Commands

```bash
bun install                      # Install dependencies
bun run desktop:dev              # Start the app (auto-assigns port)
bun run desktop:build:local      # Build unsigned .app locally, strips macOS quarantine
bun run desktop:open             # Open the last local build
```

> **Note:** `desktop:build` is for CI/release only (signed artifacts). Use `desktop:build:local` for local testing.

### Multiple worktrees simultaneously

Each worktree picks a free port automatically and gets its own isolated DB. To pin a specific port:

```bash
VITE_PORT=1422 bun run desktop:dev
```

### Database

Dev and prod builds use separate SQLite databases:

- **Dev** → `~/Library/Application Support/com.canopy.dev-<hash>/canopy.db` (one per worktree)
- **Prod** → `~/Library/Application Support/com.canopy.app/canopy.db`

```bash
bun run desktop:db:reset       # Reset dev DB for the current worktree
bun run desktop:db:reset:prod  # Reset prod DB
```

### Releasing

Push a semver tag to trigger the release pipeline:

```bash
git tag v0.2.0
git push origin v0.2.0
```

This builds the app, signs the update artifacts with the Tauri updater key, and creates a GitHub Release with the `.dmg` and `latest.json` attached. Apple code-signing is pre-wired in `.github/workflows/release.yml` — uncomment and add secrets when a Developer ID certificate is available.

Required GitHub secrets before releasing:
- `CANOPY_GITHUB_CLIENT_ID`
- `TAURI_SIGNING_PRIVATE_KEY` (content of `~/.tauri/canopy.key`)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string if key was generated without password)

### Other commands

```bash
bun --filter desktop test              # Frontend tests (Vitest)
bun --filter @canopy/terminal test # Terminal package tests
cd apps/desktop/src-tauri && cargo test # Rust tests
bun run lint                           # Lint
bun run format                         # Format
```
