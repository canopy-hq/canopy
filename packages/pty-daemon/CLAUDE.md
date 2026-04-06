# superagent-pty-daemon

Standalone Rust binary that manages PTY sessions for Superagent. Runs in its own process group — survives app restarts. PTY sessions keep running even when the app is closed.

## What this is

A minimal Unix socket server. The Tauri app connects to it, sends JSON commands, and streams binary PTY output back. Built with `portable-pty` + `tokio`.

## Protocol

Communication over a Unix domain socket at a path passed as CLI arg:

```
superagent-pty-daemon /tmp/superagent-{port}.sock
```

Commands are newline-delimited JSON. Responses vary by operation:

| Operation | Request                                                         | Response                                                     |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `spawn`   | `{"op":"spawn","paneId":"...","cwd":"...","rows":24,"cols":80}` | `{"ok":true,"pid":1234,"new":true}`                          |
| `attach`  | `{"op":"attach","paneId":"..."}`                                | scrollback bytes → sentinel `\x00\x00\x00\x00` → live stream |
| `write`   | `{"op":"write","paneId":"...","data":[...bytes...]}`            | —                                                            |
| `resize`  | `{"op":"resize","paneId":"...","rows":24,"cols":80}`            | —                                                            |
| `close`   | `{"op":"close","paneId":"..."}`                                 | —                                                            |
| `cwd`     | `{"op":"cwd","paneId":"..."}`                                   | `{"ok":true,"cwd":"/path"}`                                  |
| `list`    | `{"op":"list"}`                                                 | `{"paneIds":["..."]}`                                        |

Output frames are length-prefixed (4-byte big-endian) for reliable boundaries.

## Scrollback

Each PTY session keeps a **100 KB ring-buffer**. On attach, the full scrollback is sent first (as one frame), then the sentinel, then live output. Old data is discarded as new data arrives — this is intentional, not a bug.

## Reconnect behaviour

If `spawn` is called for a `paneId` that already has an active session, the daemon **resizes the PTY and returns the existing pid** (`new: false`). No new process is spawned. The app handles reconnection by calling `attach` afterwards.

## When to modify this

Rarely. The daemon's job is PTY lifecycle only — no business logic. Add new operations when the Tauri backend (`pty.rs`) needs a new daemon capability. Keep it:

- Stateless per-command where possible
- Free of app-level concepts (projects, tabs, agents)
- Always backwards-compatible (the daemon may outlive an app restart)

## macOS-specific: cwd lookup

`get_pid_cwd` uses `proc_pidinfo(PROC_PIDVNODEPATHINFO)` — macOS-only syscall. If Linux support is ever added, this needs a `/proc/{pid}/cwd` fallback.

## Run / build

```bash
cd packages/pty-daemon
cargo build --release
cargo test
```

The Tauri app spawns the daemon binary automatically on startup (`lib.rs` daemon lifecycle).
