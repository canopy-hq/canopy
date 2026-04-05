# Pre-Spawned Terminal Pool

Instant terminal display by pre-warming PTY sessions in the daemon so users never wait for shell boot + Starship prompt generation.

## Problem

Opening a new terminal takes ~500-600ms (mostly Starship prompt generation). An overlay hides the empty terminal during this wait, adding complexity (timing heuristics, fade logic) and still feeling sluggish.

## Solution

Daemon-side pool of 2 pre-spawned PTY sessions. On tab open, claim a warm session and `cd` into the workspace instead of cold-spawning. Replenish in background.

## Architecture

### Pool Manager (Daemon)

New `Pool` struct in the PTY daemon.

```
Pool {
    entries: VecDeque<PoolEntry>,
    target_size: usize,  // 2
}

PoolEntry {
    temp_pane_id: String,  // "__pool_0", "__pool_1"
    pid: u32,
    status: Warming | Ready,
}
```

**Lifecycle:**

1. After daemon socket is ready, spawn 2 sessions with temp paneIds (`__pool_0`, `__pool_1`), cwd = `$HOME`, size 24x80
2. Mark `Ready` once first output byte is received (shell prompt rendered)
3. On `claim { pane_id, cwd, rows, cols }`:
   - Pop first `Ready` entry from deque
   - Remap session key: `__pool_N` -> real `pane_id` in sessions map
   - Resize PTY to requested `rows x cols`
   - Return `SpawnResult { pty_id: pid, is_new: true }`
4. Caller sends `cd <cwd> && clear\n` as terminal input
5. Background task spawns replacement warm session
6. On shutdown: kill all unclaimed warm sessions

**Health monitoring:** Daemon reader thread detects EOF on warm sessions. Dead entries are removed from pool and replaced.

### New RPC Commands (Daemon)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `claim` | `pane_id, cwd, rows, cols` | `SpawnResult` or error | Claim warm session, remap paneId, resize |
| `pool_status` | none | `{ ready: u32, warming: u32 }` | Pool readiness for frontend decision |

### Tauri Bridge

New Tauri command: `claim_warm_terminal`

- Same signature as `spawn_terminal` (paneId, cwd, rows, cols, onOutput channel)
- Calls daemon `claim` RPC
- Sends `cd <cwd> && clear\n` via daemon `write` command
- Attaches output channel (same as `spawn_terminal`)
- Falls back to `spawn_terminal` if pool returns error (empty/exhausted)

New Tauri command: `pool_status`

- Exposes daemon pool readiness to frontend

### Frontend Changes

**`packages/terminal/src/pty.ts`** — Add `claimWarmTerminal()` and `getPoolStatus()` functions mirroring existing `spawnTerminal()` pattern.

**`packages/terminal/src/useTerminal.ts`** — Modify SPAWN path only:

1. Before spawning, call `getPoolStatus()`
2. If ready > 0: call `claimWarmTerminal()` — skip overlay entirely
3. If pool empty: fall back to existing `spawnTerminal()` with overlay

Cached path and reconnect path are **untouched**.

### Startup Sequencing

Pool warming is fire-and-forget after daemon socket ready. If user opens a tab before warmup completes, they get cold-spawn behavior. No blocking on app startup.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| App shutdown | Kill all unclaimed warm sessions during daemon shutdown |
| Daemon crash/restart | Frontend detects reconnect, checks `pool_status` for readiness |
| Pool exhaustion (3+ rapid tabs) | Fall back to cold `spawnTerminal()` with overlay |
| Warm session dies before claim | Daemon detects EOF, removes from pool, spawns replacement |
| `cd` fails (dir deleted) | User sees shell error — same as typing it manually |
| Resize mismatch | `claim` resizes PTY to requested dimensions before returning |

## Files to Modify

### Daemon (Rust)
- `packages/pty-daemon/src/daemon.rs` — Add `Pool` struct, `do_claim()`, pool warming logic, health monitoring
- `packages/pty-daemon/src/daemon.rs` — Add `claim` and `pool_status` RPC command handlers

### Tauri Bridge (Rust)
- `apps/desktop/src-tauri/src/pty.rs` — Add `claim_warm_terminal` and `pool_status` commands
- `apps/desktop/src-tauri/src/daemon_client.rs` — Add `claim()` and `pool_status()` client methods

### Frontend (TypeScript)
- `packages/terminal/src/pty.ts` — Add `claimWarmTerminal()` and `getPoolStatus()`
- `packages/terminal/src/useTerminal.ts` — Modify spawn path to try pool first

## Non-Goals

- Configurable pool size (hardcoded to 2)
- Pre-creating ghostty-web Terminal instances (fast enough at ~10ms)
- Pool warming before daemon socket ready
- Windows/Linux support (macOS only v1)
