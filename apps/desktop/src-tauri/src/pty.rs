use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicU64;

use sysinfo::{System, Pid, ProcessesToUpdate};

use tauri::ipc::Channel;

use crate::agent_watcher::{self, AgentWatcherState, now_millis};
use crate::daemon_client::DaemonClient;

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
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<PtyState>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<SpawnResult, String> {
    let (pid, is_new) = daemon.spawn(&pane_id, cwd.as_deref(), rows.unwrap_or(24), cols.unwrap_or(80)).await?;

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

    let last_output = Arc::new(AtomicU64::new(now_millis()));
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = daemon.attach(pane_id.clone(), on_output, last_output.clone(), ready_tx);

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

    // Agent watcher uses child PID = ptyId for tracking
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        ws.last_outputs.insert(pid, last_output.clone());
        ws.cancel_senders.insert(pid, cancel_tx);
    }
    agent_watcher::start_watching(pid, pid, app, last_output, cancel_rx);

    Ok(SpawnResult { pty_id: pid, is_new })
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

    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        if let Some(cancel) = ws.cancel_senders.remove(&pty_id) {
            let _ = cancel.send(());
        }
        ws.last_outputs.remove(&pty_id);
    }

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
            if let Some(cancel) = ws.cancel_senders.remove(&pty_id) {
                let _ = cancel.send(());
            }
            ws.last_outputs.remove(&pty_id);
        }
    }

    for (_, pane_id) in to_close {
        let _ = daemon.close(&pane_id).await;
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
