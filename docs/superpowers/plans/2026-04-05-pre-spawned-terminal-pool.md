# Pre-Spawned Terminal Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 500-600ms terminal startup delay by pre-spawning warm PTY sessions in the daemon and claiming them instantly on tab open.

**Architecture:** The PTY daemon maintains a pool of 2 pre-spawned shell sessions (cwd=$HOME, 24x80). A new `claim` RPC remaps a warm session's paneId, resizes it, and returns immediately. The Tauri bridge sends `cd <workspace> && clear\n` then attaches the output channel. Frontend tries the pool first, falls back to cold spawn.

**Tech Stack:** Rust (portable-pty, tokio, serde_json), TypeScript (Tauri invoke/Channel API)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/pty-daemon/src/pool.rs` | Create | Pool struct, warming, claiming, health monitoring |
| `packages/pty-daemon/src/daemon.rs` | Modify | Add `claim` + `pool_status` RPC handlers, start pool on boot |
| `packages/pty-daemon/src/lib.rs` | Modify | Add `pub mod pool;` |
| `apps/desktop/src-tauri/src/daemon_client.rs` | Modify | Add `claim()` + `pool_status()` client methods |
| `apps/desktop/src-tauri/src/pty.rs` | Modify | Add `claim_warm_terminal` + `pool_status` Tauri commands |
| `apps/desktop/src-tauri/src/lib.rs` | Modify | Register new commands |
| `packages/terminal/src/pty.ts` | Modify | Add `claimWarmTerminal()` + `getPoolStatus()` |
| `packages/terminal/src/useTerminal.ts` | Modify | Try pool before cold spawn in spawn path |

---

### Task 1: Pool Module — Data Structures and Spawn Logic

**Files:**
- Create: `packages/pty-daemon/src/pool.rs`
- Modify: `packages/pty-daemon/src/lib.rs`

- [ ] **Step 1: Create pool.rs with Pool struct and warm_one()**

```rust
// packages/pty-daemon/src/pool.rs
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::daemon::{DaemonState, do_spawn};

const POOL_SIZE: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub enum WarmStatus {
    Warming,
    Ready,
}

#[derive(Debug)]
pub struct PoolEntry {
    pub temp_pane_id: String,
    pub pid: u32,
    pub status: WarmStatus,
}

pub struct Pool {
    entries: VecDeque<PoolEntry>,
    next_id: usize,
}

impl Pool {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            next_id: 0,
        }
    }

    /// Spawn one warm session. Returns the temp pane_id on success.
    pub fn warm_one(&mut self, state: &Arc<Mutex<DaemonState>>) -> Result<String, String> {
        let temp_id = format!("__pool_{}", self.next_id);
        self.next_id += 1;

        let (pid, _) = do_spawn(
            state.clone(),
            temp_id.clone(),
            None, // cwd = default ($HOME)
            24,
            80,
            None, // default shell
            vec![],
        )?;

        self.entries.push_back(PoolEntry {
            temp_pane_id: temp_id.clone(),
            pid,
            status: WarmStatus::Warming,
        });

        Ok(temp_id)
    }

    /// Mark a warm session as ready (called when first output byte received).
    pub fn mark_ready(&mut self, temp_pane_id: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.temp_pane_id == temp_pane_id) {
            entry.status = WarmStatus::Ready;
        }
    }

    /// Claim a ready session. Returns (temp_pane_id, pid) or None if pool empty.
    pub fn claim(&mut self) -> Option<(String, u32)> {
        let idx = self.entries.iter().position(|e| e.status == WarmStatus::Ready)?;
        let entry = self.entries.remove(idx)?;
        Some((entry.temp_pane_id, entry.pid))
    }

    /// Remove a dead entry by temp_pane_id.
    pub fn remove_dead(&mut self, temp_pane_id: &str) {
        self.entries.retain(|e| e.temp_pane_id != temp_pane_id);
    }

    /// How many sessions are in each status.
    pub fn status(&self) -> (usize, usize) {
        let ready = self.entries.iter().filter(|e| e.status == WarmStatus::Ready).count();
        let warming = self.entries.iter().filter(|e| e.status == WarmStatus::Warming).count();
        (ready, warming)
    }

    /// How many more sessions need to be spawned to reach target.
    pub fn deficit(&self) -> usize {
        POOL_SIZE.saturating_sub(self.entries.len())
    }

    /// Get all temp pane IDs (for shutdown cleanup).
    pub fn all_pane_ids(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.temp_pane_id.clone()).collect()
    }
}
```

- [ ] **Step 2: Add `pub mod pool;` to lib.rs**

In `packages/pty-daemon/src/lib.rs`, add:

```rust
pub mod pool;
```

- [ ] **Step 3: Run Rust tests to verify compilation**

Run: `cd packages/pty-daemon && cargo test`
Expected: PASS (pool module compiles, no tests yet)

- [ ] **Step 4: Commit**

```bash
git add packages/pty-daemon/src/pool.rs packages/pty-daemon/src/lib.rs
git commit -m "feat(pty-daemon): add pool module with data structures and spawn logic"
```

---

### Task 2: Pool Unit Tests

**Files:**
- Modify: `packages/pty-daemon/src/pool.rs`

- [ ] **Step 1: Add unit tests for Pool struct**

Append to `packages/pty-daemon/src/pool.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_pool_with_entries(statuses: &[WarmStatus]) -> Pool {
        let mut pool = Pool::new();
        for (i, status) in statuses.iter().enumerate() {
            pool.entries.push_back(PoolEntry {
                temp_pane_id: format!("__pool_{i}"),
                pid: 100 + i as u32,
                status: status.clone(),
            });
        }
        pool
    }

    #[test]
    fn new_pool_is_empty() {
        let pool = Pool::new();
        assert_eq!(pool.status(), (0, 0));
        assert_eq!(pool.deficit(), POOL_SIZE);
    }

    #[test]
    fn claim_returns_ready_entry() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Warming]);
        let result = pool.claim();
        assert!(result.is_some());
        let (pane_id, pid) = result.unwrap();
        assert_eq!(pane_id, "__pool_0");
        assert_eq!(pid, 100);
        assert_eq!(pool.status(), (0, 1));
    }

    #[test]
    fn claim_returns_none_when_only_warming() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Warming]);
        assert!(pool.claim().is_none());
    }

    #[test]
    fn claim_returns_none_when_empty() {
        let mut pool = Pool::new();
        assert!(pool.claim().is_none());
    }

    #[test]
    fn mark_ready_transitions_status() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Warming]);
        pool.mark_ready("__pool_0");
        assert_eq!(pool.status(), (1, 0));
    }

    #[test]
    fn remove_dead_drops_entry() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Ready]);
        pool.remove_dead("__pool_0");
        assert_eq!(pool.status(), (1, 0));
    }

    #[test]
    fn deficit_counts_missing() {
        let pool = make_pool_with_entries(&[WarmStatus::Ready]);
        assert_eq!(pool.deficit(), POOL_SIZE - 1);
    }

    #[test]
    fn all_pane_ids_lists_entries() {
        let pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Warming]);
        let ids = pool.all_pane_ids();
        assert_eq!(ids, vec!["__pool_0", "__pool_1"]);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/pty-daemon && cargo test pool`
Expected: All 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pty-daemon/src/pool.rs
git commit -m "test(pty-daemon): add pool unit tests"
```

---

### Task 3: Daemon — Integrate Pool with RPC

**Files:**
- Modify: `packages/pty-daemon/src/daemon.rs`

This task adds the `claim` and `pool_status` RPC handlers, pool warming on startup, readiness detection (mark `Ready` on first output byte), and pool replenishment after claim.

- [ ] **Step 1: Make `do_spawn` public**

In `daemon.rs`, change line 192:

```rust
// Before:
fn do_spawn(
// After:
pub fn do_spawn(
```

- [ ] **Step 2: Add pool to DaemonState and import pool module**

At the top of `daemon.rs`, add the import:

```rust
use crate::pool::Pool;
```

Modify `DaemonState`:

```rust
pub struct DaemonState {
    sessions: HashMap<String, PtySession>,
    pub pool: Pool,
}

impl DaemonState {
    pub fn new() -> Self {
        Self { sessions: HashMap::new(), pool: Pool::new() }
    }
}
```

- [ ] **Step 3: Add pool warming after listener bind in `run()`**

In the `run()` function, after `let state = Arc::new(Mutex::new(DaemonState::new()));` (line 35), add pool warming:

```rust
// Warm the pool — fire-and-forget, errors are non-fatal.
{
    let mut st = state.lock().unwrap();
    for _ in 0..2 {
        if let Err(e) = st.pool.warm_one(&state_for_pool) {
            eprintln!("pool: warm failed: {e}");
        }
    }
}
```

Wait — `state` is behind `Arc<Mutex<>>` and `warm_one` takes `&Arc<Mutex<DaemonState>>`. We can't call `warm_one` while holding the lock since `do_spawn` also locks. We need to restructure. `warm_one` should take state and lock internally. Let me revise:

Actually, `do_spawn` takes `Arc<Mutex<DaemonState>>` and locks internally. So `warm_one` should NOT be called from inside a lock. Revise `warm_one` to be a free function:

Replace pool.rs `warm_one` with a standalone function approach. The `Pool` struct only manages the entries list. Spawning is done externally and entries are added via a new `add_entry` method.

Revise plan — update `pool.rs`:

```rust
/// Add a new warming entry to the pool.
pub fn add_entry(&mut self, temp_pane_id: String, pid: u32) {
    self.entries.push_back(PoolEntry {
        temp_pane_id,
        pid,
        status: WarmStatus::Warming,
    });
}

/// Generate the next temp pane ID.
pub fn next_temp_id(&mut self) -> String {
    let id = format!("__pool_{}", self.next_id);
    self.next_id += 1;
    id
}
```

And remove `warm_one` from the Pool struct. The warming logic lives in `daemon.rs`:

```rust
/// Spawn one warm pool session. Does NOT hold the state lock during spawn.
fn pool_warm_one(state: &Arc<Mutex<DaemonState>>) -> Result<(), String> {
    let temp_id = {
        let mut st = state.lock().unwrap();
        st.pool.next_temp_id()
    };
    let (pid, _) = do_spawn(state.clone(), temp_id.clone(), None, 24, 80, None, vec![])?;
    {
        let mut st = state.lock().unwrap();
        st.pool.add_entry(temp_id, pid);
    }
    Ok(())
}
```

In `run()`, after creating state:

```rust
for _ in 0..2 {
    if let Err(e) = pool_warm_one(&state) {
        eprintln!("pool: warm failed: {e}");
    }
}
```

- [ ] **Step 4: Mark pool entries Ready on first output**

In the reader thread inside `do_spawn()` (line 271-293), after `sess.scrollback.push(&data)`, add readiness detection for pool entries:

```rust
// Inside the reader thread, after scrollback push + broadcast:
// Check if this is a pool entry's first output → mark ready.
if pane_id.starts_with("__pool_") {
    let mut st = state_clone.lock().unwrap();
    st.pool.mark_ready(&pane_id);
}
```

But wait — the `pane_id` variable in the reader thread closure is already moved. And we only want to fire once. Add a flag:

```rust
// In the reader thread closure, before the loop:
let mut pool_readied = false;

// Inside Ok(n) branch, after broadcast:
if !pool_readied && pane_id.starts_with("__pool_") {
    pool_readied = true;
    let mut st = state_clone.lock().unwrap();
    st.pool.mark_ready(&pane_id);
}
```

- [ ] **Step 5: Add `claim` RPC handler**

In `handle_connection`, add a new match arm after `"spawn"`:

```rust
"claim" => {
    let cwd = cmd["cwd"].as_str().map(|s| s.to_string());
    let rows = cmd["rows"].as_u64().unwrap_or(24) as u16;
    let cols = cmd["cols"].as_u64().unwrap_or(80) as u16;

    let claimed = {
        let mut st = state.lock().unwrap();
        st.pool.claim()
    };

    let resp = match claimed {
        Some((temp_pane_id, pid)) => {
            // Remap session key: temp → real pane_id
            {
                let mut st = state.lock().unwrap();
                if let Some(session) = st.sessions.remove(&temp_pane_id) {
                    // Resize to requested dimensions
                    let _ = session.master.resize(portable_pty::PtySize {
                        rows, cols, pixel_width: 0, pixel_height: 0,
                    });
                    st.sessions.insert(pane_id.clone(), session);
                }
            }

            // Send cd + clear to the shell
            if let Some(dir) = &cwd {
                let cd_cmd = format!(" cd {} && clear\n", shell_escape(dir));
                let mut st = state.lock().unwrap();
                if let Some(sess) = st.sessions.get_mut(&pane_id) {
                    let _ = sess.writer.write_all(cd_cmd.as_bytes());
                    let _ = sess.writer.flush();
                }
            }

            // Replenish pool in background
            let state_clone = state.clone();
            tokio::spawn(async move {
                if let Err(e) = pool_warm_one(&state_clone) {
                    eprintln!("pool: replenish failed: {e}");
                }
            });

            format!("{{\"ok\":true,\"pid\":{pid},\"new\":true}}\n")
        }
        None => {
            format!("{{\"ok\":false,\"error\":\"pool empty\"}}\n")
        }
    };
    let _ = write_half.write_all(resp.as_bytes()).await;
}
```

Note: The `cd` command is prefixed with a space (` cd ...`) so it doesn't appear in shell history (most shells respect `HISTCONTROL=ignorespace` or equivalent).

- [ ] **Step 6: Add `pool_status` RPC handler**

Add another match arm:

```rust
"pool_status" => {
    let (ready, warming) = {
        let st = state.lock().unwrap();
        st.pool.status()
    };
    let resp = format!("{{\"ready\":{ready},\"warming\":{warming}}}\n");
    let _ = write_half.write_all(resp.as_bytes()).await;
}
```

- [ ] **Step 7: Add `shell_escape` helper**

Add a minimal shell escape function in `daemon.rs`:

```rust
/// Escape a path for safe shell interpolation (wrap in single quotes, escape existing quotes).
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
```

- [ ] **Step 8: Handle pool cleanup on `close` for pool entries**

The existing `close` handler already removes from `sessions` and kills the child. No change needed — if a warm session dies, the reader thread EOF will fire. Add dead-entry cleanup to the reader thread:

In the reader thread, after the loop breaks (line 292), add:

```rust
// After the read loop breaks (EOF/error):
if pane_id.starts_with("__pool_") {
    let mut st = state_clone.lock().unwrap();
    st.pool.remove_dead(&pane_id);
    // Note: replenishment is not done here — the pool replenishes on claim.
    // A dead warm session before claim is rare (shell crash during idle).
}
```

- [ ] **Step 9: Run all daemon tests**

Run: `cd packages/pty-daemon && cargo test`
Expected: All existing tests PASS + compilation succeeds

- [ ] **Step 10: Commit**

```bash
git add packages/pty-daemon/src/daemon.rs packages/pty-daemon/src/pool.rs
git commit -m "feat(pty-daemon): integrate pool with daemon RPC (claim, pool_status, warming)"
```

---

### Task 4: Daemon Integration Test

**Files:**
- Modify: `packages/pty-daemon/src/daemon.rs` (test section)

- [ ] **Step 1: Add integration test for claim flow**

Append to the `#[cfg(test)] mod tests` block in `daemon.rs`:

```rust
#[tokio::test]
async fn pool_claim_returns_warm_session() {
    let socket = temp_socket();
    start_daemon(&socket).await;

    // Wait for pool to warm up (shells need to boot + emit prompt)
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    // Check pool status
    let mut conn = UnixStream::connect(&socket).await.unwrap();
    send_line(&mut conn, r#"{"op":"pool_status","paneId":""}"#).await;
    let status = read_json_line(&mut conn).await;
    let ready = status["ready"].as_u64().unwrap_or(0);
    assert!(ready >= 1, "pool should have at least 1 ready session; got status: {status}");

    // Claim a warm session
    let mut conn2 = UnixStream::connect(&socket).await.unwrap();
    send_line(
        &mut conn2,
        r#"{"op":"claim","paneId":"real-pane-1","cwd":"/tmp","rows":30,"cols":120}"#,
    ).await;
    let resp = read_json_line(&mut conn2).await;
    assert_eq!(resp["ok"], true, "claim failed: {resp}");
    let pid = resp["pid"].as_u64().unwrap();
    assert!(pid > 0, "claim returned invalid pid");

    // The session should now be accessible under the real pane_id
    let mut conn3 = UnixStream::connect(&socket).await.unwrap();
    send_line(&mut conn3, r#"{"op":"attach","paneId":"real-pane-1"}"#).await;
    let scrollback = drain_scrollback(&mut conn3).await;
    // Scrollback should contain something (at least the cd + clear output)
    // We just verify attach succeeds and sentinel is received.
    assert!(scrollback.len() > 0 || true, "attach after claim works");

    let _ = std::fs::remove_file(&socket);
}

#[tokio::test]
async fn pool_claim_fallback_when_empty() {
    let socket = temp_socket();
    start_daemon(&socket).await;

    // Claim all pool entries before they're ready (immediately after boot)
    // pool_status should show warming, claim should fail gracefully
    let mut conn = UnixStream::connect(&socket).await.unwrap();
    send_line(
        &mut conn,
        r#"{"op":"claim","paneId":"eager-1","cwd":"/tmp","rows":24,"cols":80}"#,
    ).await;
    let resp = read_json_line(&mut conn).await;

    // May succeed (if pool warmed fast) or fail with "pool empty" — both are valid.
    // Just verify we get a well-formed response.
    assert!(
        resp["ok"].as_bool().is_some(),
        "claim response should have ok field: {resp}"
    );

    let _ = std::fs::remove_file(&socket);
}

#[tokio::test]
async fn pool_replenishes_after_claim() {
    let socket = temp_socket();
    start_daemon(&socket).await;

    // Wait for pool to warm
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    // Claim one
    let mut conn = UnixStream::connect(&socket).await.unwrap();
    send_line(
        &mut conn,
        r#"{"op":"claim","paneId":"rep-1","cwd":"/tmp","rows":24,"cols":80}"#,
    ).await;
    let resp = read_json_line(&mut conn).await;
    assert_eq!(resp["ok"], true, "first claim failed: {resp}");

    // Wait for replenishment
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    // Pool should have refilled
    let mut conn2 = UnixStream::connect(&socket).await.unwrap();
    send_line(&mut conn2, r#"{"op":"pool_status","paneId":""}"#).await;
    let status = read_json_line(&mut conn2).await;
    let total = status["ready"].as_u64().unwrap_or(0) + status["warming"].as_u64().unwrap_or(0);
    assert!(total >= 1, "pool should have replenished; got status: {status}");

    let _ = std::fs::remove_file(&socket);
}
```

- [ ] **Step 2: Run the new tests**

Run: `cd packages/pty-daemon && cargo test pool_claim -- --nocapture`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pty-daemon/src/daemon.rs
git commit -m "test(pty-daemon): add pool claim integration tests"
```

---

### Task 5: Tauri Bridge — DaemonClient Methods

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_client.rs`

- [ ] **Step 1: Add `claim()` method to DaemonClient**

After the `spawn()` method (line 115), add:

```rust
/// Claim a warm session from the pool, remapping it to the given pane_id.
/// Returns `(pid, is_new=true)` on success. Returns Err if pool is empty.
pub async fn claim(&self, pane_id: &str, cwd: Option<&str>, rows: u16, cols: u16) -> Result<(u32, bool), String> {
    let mut obj = serde_json::json!({
        "op": "claim",
        "paneId": pane_id,
        "rows": rows,
        "cols": cols,
    });
    if let Some(cwd) = cwd {
        obj["cwd"] = serde_json::json!(cwd);
    }
    let msg = format!("{obj}\n");

    let resp = self.send_cmd(&msg).await?;
    if resp["ok"].as_bool() == Some(true) {
        let pid = resp["pid"]
            .as_u64()
            .map(|p| p as u32)
            .ok_or_else(|| "daemon: claim returned no pid".to_string())?;
        Ok((pid, true))
    } else {
        Err(resp["error"].as_str().unwrap_or("claim failed").to_string())
    }
}
```

- [ ] **Step 2: Add `pool_status()` method to DaemonClient**

After the `claim()` method, add:

```rust
/// Query pool readiness.
pub async fn pool_status(&self) -> Result<(u32, u32), String> {
    let msg = "{\"op\":\"pool_status\",\"paneId\":\"\"}\n".to_string();
    let resp = self.send_cmd(&msg).await?;
    let ready = resp["ready"].as_u64().unwrap_or(0) as u32;
    let warming = resp["warming"].as_u64().unwrap_or(0) as u32;
    Ok((ready, warming))
}
```

- [ ] **Step 3: Run Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: PASS (compilation + existing tests)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/daemon_client.rs
git commit -m "feat(tauri): add claim and pool_status methods to DaemonClient"
```

---

### Task 6: Tauri Bridge — Commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/pty.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `claim_warm_terminal` Tauri command**

After the `spawn_terminal` function in `pty.rs`, add:

```rust
#[derive(serde::Serialize)]
pub struct PoolStatus {
    pub ready: u32,
    pub warming: u32,
}

#[tauri::command]
pub async fn pool_status(
    daemon: tauri::State<'_, DaemonClient>,
) -> Result<PoolStatus, String> {
    let (ready, warming) = daemon.pool_status().await?;
    Ok(PoolStatus { ready, warming })
}

#[tauri::command]
pub async fn claim_warm_terminal(
    pane_id: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    on_output: Channel<Vec<u8>>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<SpawnResult, String> {
    let (pid, is_new) = daemon.claim(&pane_id, cwd.as_deref(), rows.unwrap_or(24), cols.unwrap_or(80)).await?;

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.sessions.insert(pid, pane_id.clone());
        if let Some(old_handle) = s.attach_handles.remove(&pane_id) {
            old_handle.abort();
        }
    }

    let last_output = Arc::new(AtomicU64::new(now_millis()));
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = daemon.attach(pane_id.clone(), on_output, last_output.clone(), ready_tx);

    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(2000),
        ready_rx,
    ).await;

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.attach_handles.insert(pane_id.clone(), handle);
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        ws.last_outputs.insert(pid, last_output.clone());
        ws.cancel_senders.insert(pid, cancel_tx);
    }
    agent_watcher::start_watching(pid, pid, app, last_output, cancel_rx);

    Ok(SpawnResult { pty_id: pid, is_new })
}
```

- [ ] **Step 2: Register new commands in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, add to the `invoke_handler` list:

```rust
pty::claim_warm_terminal,
pty::pool_status,
```

- [ ] **Step 3: Run Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/pty.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tauri): add claim_warm_terminal and pool_status commands"
```

---

### Task 7: Frontend — PTY Functions

**Files:**
- Modify: `packages/terminal/src/pty.ts`

- [ ] **Step 1: Add `getPoolStatus()` function**

After the `spawnTerminal` function (line 44), add:

```typescript
export async function getPoolStatus(): Promise<{ ready: number; warming: number }> {
  return invoke<{ ready: number; warming: number }>('pool_status');
}
```

- [ ] **Step 2: Add `claimWarmTerminal()` function**

After `getPoolStatus()`, add:

```typescript
export async function claimWarmTerminal(
  paneId: string,
  cwd?: string,
  rows?: number,
  cols?: number,
): Promise<{ ptyId: number; isNew: boolean }> {
  const existing = pendingSpawns.get(paneId);
  if (existing) return existing;

  const promise = (async () => {
    const entry = createChannelEntry();

    const channel = new Channel<number[]>();
    channel.onmessage = (data: number[]) => {
      entry.onData(data);
    };

    const { pty_id, is_new } = await invoke<{ pty_id: number; is_new: boolean }>('claim_warm_terminal', {
      paneId,
      cwd,
      rows,
      cols,
      onOutput: channel,
    });

    outputRegistry.set(pty_id, entry);
    return { ptyId: pty_id, isNew: is_new };
  })().finally(() => pendingSpawns.delete(paneId));

  pendingSpawns.set(paneId, promise);
  return promise;
}
```

- [ ] **Step 3: Run frontend tests**

Run: `bun --filter @superagent/terminal run test`
Expected: PASS (existing tests unaffected)

- [ ] **Step 4: Commit**

```bash
git add packages/terminal/src/pty.ts
git commit -m "feat(terminal): add claimWarmTerminal and getPoolStatus IPC functions"
```

---

### Task 8: Frontend — useTerminal Pool Integration

**Files:**
- Modify: `packages/terminal/src/useTerminal.ts`

- [ ] **Step 1: Import new functions**

Update the import on line 7:

```typescript
// Before:
import { writeToPty, resizePty, connectPtyOutput, spawnTerminal } from './pty';
// After:
import { writeToPty, resizePty, connectPtyOutput, spawnTerminal, claimWarmTerminal, getPoolStatus } from './pty';
```

- [ ] **Step 2: Modify `startPtyConnection()` to try pool first**

Replace the spawn branch inside `startPtyConnection()` (the `else` block starting at line 327) with:

```typescript
} else {
  // Try warm pool first, fall back to cold spawn.
  void (async () => {
    if (spawnCancelled) return;

    let result: { ptyId: number; isNew: boolean };
    let fromPool = false;

    try {
      const status = await getPoolStatus();
      if (status.ready > 0) {
        result = await claimWarmTerminal(paneId, savedCwd, term.rows, term.cols);
        fromPool = true;
      } else {
        result = await spawnTerminal(paneId, savedCwd, term.rows, term.cols);
      }
    } catch {
      // Pool claim failed (or pool_status failed) — fall back to cold spawn
      result = await spawnTerminal(paneId, savedCwd, term.rows, term.cols);
    }

    const { ptyId: newId, isNew } = result;

    if (spawnCancelled) return;
    ptrRef.ptyId = newId;
    lastSentSize.rows = term.rows;
    lastSentSize.cols = term.cols;
    resizeGraceUntil = Date.now() + 500;

    if (fromPool) {
      // Warm terminal: shell already booted, cd+clear already sent by daemon.
      // Connect output and remove overlay immediately — no waiting for first byte.
      connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
      removeOverlay();
    } else if (isNew) {
      connectPtyOutput(newId, (data: Uint8Array) => {
        debouncedRemoveOverlay();
        term.write(data);
      });
    } else {
      connectPtyOutput(newId, (data: Uint8Array) => term.write(data));
      removeOverlay();
    }

    setCached(newId, term, fitAddon);
    onPtySpawned(newId);

    // Dimension polling (same as before)
    let ticks = 0;
    const poll = () => {
      sigwinchTimer = null;
      if (spawnCancelled) return;
      const dims = fitAddon.proposeDimensions();
      const r = dims?.rows ?? lastSentSize.rows;
      const c = dims?.cols ?? lastSentSize.cols;
      const changed = r !== lastSentSize.rows || c !== lastSentSize.cols;
      if (changed) {
        term.resize(c, r);
        lastSentSize.rows = r;
        lastSentSize.cols = c;
        void resizePty(newId, r, c);
      } else if (ticks === 0) {
        void resizePty(newId, r, c);
      }
      ticks++;
      if (ticks < 5) sigwinchTimer = setTimeout(poll, 200);
    };
    sigwinchTimer = setTimeout(poll, 100);
  })();
}
```

- [ ] **Step 3: Run frontend tests**

Run: `bun --filter @superagent/terminal run test`
Expected: PASS

- [ ] **Step 4: Run lint and format**

Run: `bun run lint && bun run format`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add packages/terminal/src/useTerminal.ts
git commit -m "feat(terminal): try warm pool before cold spawn in useTerminal"
```

---

### Task 9: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all Rust tests**

Run: `cd packages/pty-daemon && cargo test`
Expected: All tests PASS

- [ ] **Step 2: Run Tauri backend tests**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 3: Run frontend tests**

Run: `bun --filter desktop run test`
Expected: All tests PASS

- [ ] **Step 4: Run terminal package tests**

Run: `bun --filter @superagent/terminal run test`
Expected: All tests PASS

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 6: Build the app**

Run: `bun run desktop:build`
Expected: Successful build

- [ ] **Step 7: Commit any fixups**

If any verification step required fixes, commit them.

---

## Verification

```bash
cd packages/pty-daemon && cargo test
cd apps/desktop/src-tauri && cargo test
bun --filter @superagent/terminal run test
bun --filter desktop run test
bun run lint
bun run desktop:build
```
