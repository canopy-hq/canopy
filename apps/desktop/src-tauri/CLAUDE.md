# Rust Backend — apps/desktop/src-tauri

Tauri v2 backend. Rust handles everything that is native, OS-level, or performance-critical.

## The fundamental rule

**If it's native or perf-critical, it must be in Rust.**

TypeScript is for UI logic only. Move to Rust when the work is:

- **OS-native** — file system, process management, signals, unix sockets
- **I/O-bound** — git operations, directory scanning, large file reads
- **CPU-intensive** — anything running on 40+ repos or 2000+ items at scale
- **Tight-loop polling** — agent detection, process-tree walks (250 ms intervals)

Never implement these in TypeScript and call them in a loop. Build a batched Rust command instead.

## Modules

| Module             | Responsibility                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `git.rs`           | All git2 ops: branches, worktrees, diff stats. `spawn_blocking` + `Semaphore(6)`. Batch variants for N-repo calls. |
| `pty.rs`           | Bridges daemon client + agent watcher. `spawn_terminal` → daemon spawn → attach Channel → start watcher.           |
| `agent_watcher.rs` | libproc process-tree walk. Detects claude, codex, aider, gemini. 250 ms poll, emits events on state change only.   |
| `daemon_client.rs` | Unix socket client for pty-daemon. Fresh connection per spawn/close; persistent for write/resize.                  |
| `lib.rs`           | Tauri setup: plugins, menu, daemon lifecycle, DB path, updater, window hide-on-close (PTY sessions survive restart). |

## PTY Daemon

Standalone binary (`superagent-pty-daemon`) in its own process group — survives app restart. Protocol: newline-delimited JSON commands, binary-framed output. Scrollback: 100 KB ring-buffer replayed on attach.

## IPC

```
TypeScript  →  invoke<T>('command_name', { args })
           →  #[tauri::command] fn in Rust
           →  spawn_blocking (for git2 / IO)
           →  serialize result (#[serde(rename_all = "camelCase")])
           →  TypeScript
```

Events (agent status): `app_handle.emit('event', payload)` → `listen('event', callback)` in TS.

**Conventions:**

- TypeScript wrappers in `src/lib/git.ts` — thin typed `invoke<T>()` calls, no business logic
- `#[serde(rename_all = "camelCase")]` on all structs crossing the IPC boundary
- All git2 / IO operations must use `spawn_blocking`

## Performance rules

- **Batch, never loop.** Never fire N individual IPC calls when one batched command works. Always provide batch variants (e.g. `get_all_diff_stats`, not N × `get_diff_stats`).
- **Cap concurrency.** Use `tokio::sync::Semaphore` — max 6–8 concurrent `spawn_blocking` tasks. Never let 40 blocking tasks run simultaneously.
- **Filter before serialize.** Drop zero/empty results in Rust before sending over IPC — never send data the frontend will discard.
- **Emit on change only.** Event emitters (agent watcher, …) must compare previous state and skip emission when nothing changed.

## git2 rules

- **`git2::Repository` is `!Send`.** Never cache or share across threads. Open a fresh instance per operation inside `spawn_blocking`.
- **Always `spawn_blocking` for git2.** Every git2 call blocks on disk I/O.

## Testing

- Inline `#[cfg(test)]` modules
- `tempfile::TempDir` for git repo fixtures
- `#[tokio::test]` for async commands
- Run: `cd apps/desktop/src-tauri && cargo test`
