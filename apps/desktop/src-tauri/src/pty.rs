use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicU64;

use tauri::ipc::Channel;

use crate::agent_watcher::{self, AgentWatcherState, now_millis};
use crate::daemon_client::DaemonClient;

/// Maps ptyId (child PID) → paneId for routing write/resize/close through the daemon.
pub struct PtyProxy {
    sessions: HashMap<u32, String>,
}

impl PtyProxy {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }
}

#[tauri::command]
pub async fn spawn_terminal(
    pane_id: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    on_output: Channel<Vec<u8>>,
    app: tauri::AppHandle,
    proxy: tauri::State<'_, Mutex<PtyProxy>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<u32, String> {
    let pid = daemon.spawn(&pane_id, cwd.as_deref(), rows.unwrap_or(24), cols.unwrap_or(80)).await?;

    {
        let mut p = proxy.lock().map_err(|e| e.to_string())?;
        p.sessions.insert(pid, pane_id.clone());
    }

    let last_output = Arc::new(AtomicU64::new(now_millis()));
    daemon.attach(pane_id.clone(), on_output, last_output.clone());

    // Agent watcher uses child PID = ptyId for tracking
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        ws.last_outputs.insert(pid, last_output.clone());
        ws.cancel_senders.insert(pid, cancel_tx);
    }
    agent_watcher::start_watching(pid, pid, app, last_output, cancel_rx);

    Ok(pid)
}

#[tauri::command]
pub async fn write_to_pty(
    pty_id: u32,
    data: Vec<u8>,
    proxy: tauri::State<'_, Mutex<PtyProxy>>,
    daemon: tauri::State<'_, DaemonClient>,
) -> Result<(), String> {
    let pane_id = {
        let p = proxy.lock().map_err(|e| e.to_string())?;
        p.sessions.get(&pty_id).cloned().ok_or_else(|| format!("PTY {pty_id} not found"))?
    };
    daemon.write(&pane_id, &data).await
}

#[tauri::command]
pub async fn resize_pty(
    pty_id: u32,
    rows: u16,
    cols: u16,
    proxy: tauri::State<'_, Mutex<PtyProxy>>,
    daemon: tauri::State<'_, DaemonClient>,
) -> Result<(), String> {
    let pane_id = {
        let p = proxy.lock().map_err(|e| e.to_string())?;
        p.sessions.get(&pty_id).cloned().ok_or_else(|| format!("PTY {pty_id} not found"))?
    };
    daemon.resize(&pane_id, rows, cols).await
}

#[tauri::command]
pub async fn close_pty(
    pty_id: u32,
    proxy: tauri::State<'_, Mutex<PtyProxy>>,
    daemon: tauri::State<'_, DaemonClient>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    let pane_id = {
        let mut p = proxy.lock().map_err(|e| e.to_string())?;
        p.sessions.remove(&pty_id).ok_or_else(|| format!("PTY {pty_id} not found"))?
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

/// Get the CWD of the shell process. Since ptyId = child PID, we call libproc directly.
#[tauri::command]
pub fn get_pty_cwd(pty_id: u32) -> Result<String, String> {
    let path = libproc::proc_pid::pidcwd(pty_id as i32).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pty_proxy_new() {
        let proxy = PtyProxy::new();
        assert!(proxy.sessions.is_empty());
    }

    #[test]
    fn test_pty_proxy_insert_lookup() {
        let mut proxy = PtyProxy::new();
        proxy.sessions.insert(1234, "pane-abc".to_string());
        assert_eq!(proxy.sessions.get(&1234), Some(&"pane-abc".to_string()));
        assert!(proxy.sessions.get(&9999).is_none());
    }

    #[test]
    fn test_pty_proxy_remove() {
        let mut proxy = PtyProxy::new();
        proxy.sessions.insert(42, "pane-xyz".to_string());
        let removed = proxy.sessions.remove(&42);
        assert_eq!(removed, Some("pane-xyz".to_string()));
        assert!(proxy.sessions.is_empty());
    }
}
