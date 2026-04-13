// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  CAUTION — PERFORMANCE-CRITICAL & RACE-CONDITION-SENSITIVE MODULE  ⚠️   ║
// ║                                                                            ║
// ║  This module orchestrates PTY lifecycle: pool claim-first spawn, attach    ║
// ║  task dedup, scrollback sentinel signaling, and bulk cleanup. Subtle bugs  ║
// ║  here cause doubled terminal output, blank screens, or zombie processes.   ║
// ║                                                                            ║
// ║  Before modifying:                                                         ║
// ║    1. Read the integration tests in packages/terminal/test/integration/    ║
// ║    2. Read the channel-manager tests in packages/terminal/test/            ║
// ║    3. Understand the claim → attach → sentinel → ready flow end-to-end    ║
// ║    4. Test with rapid tab open/close and project switching                 ║
// ║                                                                            ║
// ║  Key invariants:                                                           ║
// ║    - Only ONE attach task per paneId (old ones are aborted)                ║
// ║    - spawn_terminal must not return until sentinel is received (or timeout) ║
// ║    - Pool claim has a 200ms timeout — stale daemons fall back to spawn     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

use std::collections::HashMap;
use std::sync::Mutex;

use sysinfo::{System, Pid, ProcessesToUpdate};

use tauri::ipc::Channel;

use crate::agent_watcher::AgentWatcherState;
use crate::daemon_client::DaemonClient;
use crate::hook_server::HookServerState;

/// Build env vars for hook system injection from the hook server state.
/// Returns `None` if the hook server failed to start (port=0).
fn hook_env_vars(hook_server: &HookServerState, pane_id: Option<&str>) -> Option<std::collections::HashMap<String, String>> {
    if hook_server.port == 0 {
        return None;
    }
    let mut vars = std::collections::HashMap::new();
    if let Some(id) = pane_id {
        vars.insert("CANOPY_PANE_ID".to_string(), id.to_string());
    }
    vars.insert("CANOPY_PORT".to_string(), hook_server.port.to_string());
    vars.insert("CANOPY_TOKEN".to_string(), hook_server.token.clone());
    Some(vars)
}

/// PTY session state: maps ptyId (child PID) → paneId for IPC routing,
/// and owns the sysinfo System for targeted per-PID resource queries.
pub struct PtyState {
    sessions: HashMap<u32, String>,
    sys: System,
    /// Active attach task per paneId. Aborted when a new attach supersedes it,
    /// preventing multiple concurrent tasks from broadcasting the same PTY output
    /// to separate Tauri channels (which would cause doubled terminal output).
    attach_handles: HashMap<String, tokio::task::JoinHandle<()>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self { sessions: HashMap::new(), sys: System::new(), attach_handles: HashMap::new() }
    }

    /// Find the pty_id (child PID) for a given pane_id.
    pub fn pty_id_for_pane(&self, pane_id: &str) -> Option<u32> {
        self.sessions.iter()
            .find(|(_, pane)| pane.as_str() == pane_id)
            .map(|(&pid, _)| pid)
    }
}

#[derive(serde::Serialize)]
pub struct SpawnResult {
    pub pty_id: u32,
    pub is_new: bool,
}

#[tauri::command]
pub async fn spawn_terminal(
    pane_id: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    on_output: Channel<Vec<u8>>,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
    hook_server: tauri::State<'_, HookServerState>,
) -> Result<SpawnResult, String> {
    // Validate CWD exists before passing to daemon — stale paths from session
    // restore or deleted worktrees would cause silent failures.
    let validated_cwd = cwd.filter(|p| {
        let exists = std::path::Path::new(p.as_str()).is_dir();
        if !exists {
            eprintln!("[pty] spawn_terminal: cwd does not exist, using default: {p}");
        }
        exists
    });

    let env_vars = hook_env_vars(&hook_server, Some(&pane_id));
    if env_vars.is_some() {
        eprintln!("[pty] env_vars for pane={pane_id}: port={} token={}…", hook_server.port, &hook_server.token[..8]);
    } else {
        eprintln!("[pty] WARNING: hook_server.port=0, skipping env vars for pane={pane_id}");
    }

    let (pid, is_new) = {
        let r = rows.unwrap_or(24);
        let c = cols.unwrap_or(80);
        // Try to claim a pre-warmed PTY from the pool first.
        // 200ms timeout guards against stale daemons that don't know "claim".
        match tokio::time::timeout(
            std::time::Duration::from_millis(200),
            daemon.claim(&pane_id, validated_cwd.as_deref(), r, c, env_vars.as_ref()),
        ).await {
            Ok(Ok(result)) if !result.empty => {
                eprintln!("[pool] CLAIMED pid={} for pane={pane_id}", result.pid);
                // Pool PTY is a fresh shell — treat as new so the frontend sends
                // any initialCommand (e.g. `claude`) and uses the debounce overlay.
                (result.pid, true)
            }
            other => {
                eprintln!("[pool] FALLBACK to spawn for pane={pane_id} (claim result: {other:?})");
                daemon.spawn(&pane_id, validated_cwd.as_deref(), r, c, env_vars.as_ref()).await?
            }
        }
    };

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.sessions.insert(pid, pane_id.clone());
        // Abort any previous attach task for this pane before starting a new one.
        // Multiple concurrent attach tasks for the same paneId each broadcast the
        // full PTY output stream to their own Tauri channel — if two channels are
        // active simultaneously, both fire onmessage, both call term.write, and
        // every character appears twice in the terminal.
        if let Some(old_handle) = s.attach_handles.remove(&pane_id) {
            old_handle.abort();
        }
    }

    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = daemon.attach(pane_id.clone(), on_output, ready_tx);

    // Wait until the attach task forwards the sentinel frame (end of scrollback replay).
    // This guarantees the TypeScript ChannelEntry has buffered data when the invoke
    // resolves — eliminating the blank-terminal race between handler wiring and data arrival.
    // 2 s timeout guards against slow or unavailable daemons.
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(2000),
        ready_rx,
    ).await;

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.attach_handles.insert(pane_id.clone(), handle);
    }

    // Write sidecar file so canopy-notify can discover the pane_id by walking
    // up the process tree. Pool shells don't have CANOPY_PANE_ID in their env
    // (it's not known at spawn time), so this file is the fallback.
    write_pane_id_file(pid, &pane_id);

    Ok(SpawnResult { pty_id: pid, is_new })
}

/// Write `~/.canopy/run/<shell_pid>` containing the pane_id.
/// canopy-notify walks the process tree to find this file.
fn write_pane_id_file(shell_pid: u32, pane_id: &str) {
    if let Some(home) = dirs::home_dir() {
        let run_dir = home.join(".canopy").join("run");
        let _ = std::fs::create_dir_all(&run_dir);
        let _ = std::fs::write(run_dir.join(shell_pid.to_string()), pane_id);
    }
}

/// Remove the pane_id sidecar file on PTY close.
fn remove_pane_id_file(shell_pid: u32) {
    if let Some(home) = dirs::home_dir() {
        let _ = std::fs::remove_file(home.join(".canopy").join("run").join(shell_pid.to_string()));
    }
}

#[tauri::command]
pub async fn write_to_pty(
    pty_id: u32,
    data: Vec<u8>,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
) -> Result<(), String> {
    let pane_id = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.sessions.get(&pty_id).cloned().ok_or_else(|| format!("PTY {pty_id} not found"))?
    };
    daemon.write(&pane_id, &data).await
}

#[tauri::command]
pub async fn resize_pty(
    pty_id: u32,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
) -> Result<(), String> {
    let pane_id = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.sessions.get(&pty_id).cloned().ok_or_else(|| format!("PTY {pty_id} not found"))?
    };
    daemon.resize(&pane_id, rows, cols).await
}

#[tauri::command]
pub async fn close_pty(
    pty_id: u32,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    let pane_id = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        let pane_id = s.sessions.remove(&pty_id).ok_or_else(|| format!("PTY {pty_id} not found"))?;
        if let Some(handle) = s.attach_handles.remove(&pane_id) {
            handle.abort();
        }
        pane_id
    };

    watcher_state.lock().map_err(|e| e.to_string())?.hook_states.remove(&pty_id);

    remove_pane_id_file(pty_id);
    daemon.close(&pane_id).await
}

/// Info about a single active PTY session, including live resource usage.
#[derive(serde::Serialize)]
pub struct PtySessionInfo {
    pub pty_id: u32,
    pub pane_id: String,
    pub cpu_percent: f32,
    pub memory_mb: u64,
}

/// List all active PTY sessions with live CPU/memory stats.
/// Refreshes only the tracked PIDs (not the entire process table).
#[tauri::command]
pub fn list_pty_sessions(
    state: tauri::State<'_, Mutex<PtyState>>,
) -> Result<Vec<PtySessionInfo>, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;

    let pids: Vec<Pid> = s.sessions.keys().map(|&id| Pid::from_u32(id)).collect();
    if !pids.is_empty() {
        s.sys.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    }

    Ok(s.sessions
        .iter()
        .map(|(&pid, pane_id)| {
            let (cpu_percent, memory_mb) = s.sys
                .process(Pid::from_u32(pid))
                .map(|p| (p.cpu_usage(), p.memory() / 1024 / 1024))
                .unwrap_or((0.0, 0));
            PtySessionInfo { pty_id: pid, pane_id: pane_id.clone(), cpu_percent, memory_mb }
        })
        .collect())
}

/// Close all PTY sessions whose pane_id matches any in the given list.
/// Catch-all cleanup for tab/project close — handles PTYs that were spawned
/// (e.g. by startup restore) but whose ptyId never reached the frontend pane
/// tree due to a race condition with the close operation.
#[tauri::command]
pub async fn close_ptys_for_panes(
    pane_ids: Vec<String>,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    let pane_set: std::collections::HashSet<&str> = pane_ids.iter().map(|s| s.as_str()).collect();

    let to_close: Vec<(u32, String)> = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        let mut found = Vec::new();
        s.sessions.retain(|&pty_id, pane_id| {
            if pane_set.contains(pane_id.as_str()) {
                found.push((pty_id, pane_id.clone()));
                false // remove
            } else {
                true // keep
            }
        });
        for (_, pane_id) in &found {
            if let Some(handle) = s.attach_handles.remove(pane_id) {
                handle.abort();
            }
        }
        found
    };

    if to_close.is_empty() {
        return Ok(());
    }

    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        for &(pty_id, _) in &to_close {
            ws.hook_states.remove(&pty_id);
        }
    }

    for (pty_id, pane_id) in &to_close {
        remove_pane_id_file(*pty_id);
        let _ = daemon.close(pane_id).await;
    }

    Ok(())
}

/// Get the CWD of a PTY session's shell via the daemon (which spawned the shells).
#[tauri::command]
pub async fn get_pty_cwd(
    pane_id: String,
    daemon: tauri::State<'_, crate::daemon_client::DaemonClient>,
) -> Result<String, String> {
    daemon.get_cwd(&pane_id).await
}

/// Pre-warm the daemon's PTY pool for the given CWD.
/// Called once when a project is opened or switched.
/// Pool shells inherit CANOPY_PORT and CANOPY_TOKEN at spawn time so hook
/// callbacks work without visible `export` commands in the terminal.
#[tauri::command]
pub async fn init_terminal_pool(
    cwd: String,
    daemon: tauri::State<'_, DaemonClient>,
    hook_server: tauri::State<'_, HookServerState>,
) -> Result<(), String> {
    if !std::path::Path::new(&cwd).is_dir() {
        eprintln!("[pool] init_terminal_pool skipped — cwd does not exist: {cwd}");
        return Ok(());
    }
    // Bake CANOPY_PORT and CANOPY_TOKEN into pool shells at spawn time.
    // CANOPY_PANE_ID is set per-pane via sidecar file on claim (see spawn_terminal).
    let env_vars = hook_env_vars(&hook_server, None);
    eprintln!("[pool] init_terminal_pool called with cwd={cwd}");
    let result = daemon.init_pool(&cwd, 3, env_vars.as_ref()).await;
    eprintln!("[pool] init_terminal_pool result: {result:?}");
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pty_proxy_new() {
        let proxy = PtyState::new();
        assert!(proxy.sessions.is_empty());
    }

    #[test]
    fn test_pty_proxy_insert_lookup() {
        let mut proxy = PtyState::new();
        proxy.sessions.insert(1234, "pane-abc".to_string());
        assert_eq!(proxy.sessions.get(&1234), Some(&"pane-abc".to_string()));
        assert!(proxy.sessions.get(&9999).is_none());
    }

    #[test]
    fn test_pty_proxy_remove() {
        let mut proxy = PtyState::new();
        proxy.sessions.insert(42, "pane-xyz".to_string());
        let removed = proxy.sessions.remove(&42);
        assert_eq!(removed, Some("pane-xyz".to_string()));
        assert!(proxy.sessions.is_empty());
    }
}
