# Backend Conventions

Rust backend architecture, IPC patterns, and performance rules.

## Modules

| Module | Responsibility |
|--------|---------------|
| `git.rs` | All git2 ops: branches, worktrees, diff stats. `spawn_blocking` + `Semaphore(6)` for async. Batch variant `get_all_diff_stats` for N repos in one call. |
| `pty.rs` | Bridges daemon client + agent watcher. `spawn_terminal` → daemon spawn → attach Channel → start agent watcher. |
| `agent_watcher.rs` | libproc process-tree walk. Known agents: claude, codex, aider, gemini. 250ms poll, emits `agent-status-changed` events on state change only. |
| `daemon_client.rs` | Unix socket client for pty-daemon. Fresh connection per request (spawn/close), persistent connection for fire-and-forget (write/resize). |
| `lib.rs` | Tauri setup: plugins, menu, daemon lifecycle, window hide-on-close (PTY sessions survive). |

## PTY Daemon

Standalone binary (`superagent-pty-daemon`) in own process group — survives app restart. Protocol: newline-delimited JSON commands, binary framed output. Scrollback: 100KB ring-buffer replayed on attach.

## IPC

### Pattern

TypeScript → `invoke<T>('command_name', { args })` → Rust `#[tauri::command]` → `spawn_blocking` for git2/IO → serialize result → TypeScript.

Events (agent status): Rust `app_handle.emit('event', payload)` → TypeScript `listen('event', callback)`.

### Conventions

- TypeScript wrappers in `lib/git.ts` — thin typed `invoke<T>()` calls
- `#[serde(rename_all = "camelCase")]` on all Rust structs crossing IPC boundary
- All git2/IO operations must use `spawn_blocking`

## Performance

### Batching & concurrency

- **Batch, never loop.** Never fire N individual IPC calls when one batched call works. Always provide batch variants for commands called in loops (e.g., `get_all_diff_stats` not N x `get_diff_stats`).
- **Cap concurrency.** Use `tokio::sync::Semaphore` to limit concurrent `spawn_blocking` tasks (max 6-8). Never let 40 blocking tasks run simultaneously.
- **Filter before serialize.** Drop zero/empty results before sending over IPC — don't send data the frontend will discard.

### git2 rules

- **`git2::Repository` is `!Send`.** Never cache or share across threads. Open fresh per operation inside `spawn_blocking`.
- **Always `spawn_blocking` for git2.** All git2 operations block on disk I/O.

## Testing

- Inline `#[cfg(test)]` modules
- `tempfile::TempDir` for git repo fixtures
- `#[tokio::test]` for async commands
- Run: `cd apps/desktop/src-tauri && cargo test`
