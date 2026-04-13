use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Working,
    Permission,
    Stopped,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentStatus::Working => "working",
            AgentStatus::Permission => "permission",
            AgentStatus::Stopped => "stopped",
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusPayload {
    pub pty_id: u32,
    pub status: String,
    pub agent_name: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_state: Option<String>,
}

// ── Shared state ───────────────────────────────────────────────────────

pub struct AgentWatcherState {
    /// Hook-based agent states, keyed by pty_id.
    pub hook_states: HashMap<u32, AgentStatus>,
    /// PID watcher tasks, keyed by pty_id. Abort on PTY close or agent stop.
    pid_watchers: HashMap<u32, tauri::async_runtime::JoinHandle<()>>,
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            hook_states: HashMap::new(),
            pid_watchers: HashMap::new(),
        }
    }

    /// Cancel and remove the PID watcher for a PTY, if any.
    pub fn cancel_pid_watcher(&mut self, pty_id: u32) {
        if let Some(handle) = self.pid_watchers.remove(&pty_id) {
            handle.abort();
        }
    }
}

/// Spawn a lightweight task that polls `kill(pid, 0)` every 2 s and emits
/// `agent-status-changed` (Stopped) when the process no longer exists.
/// This covers the case where Claude is killed via Ctrl+C without firing a Stop hook.
fn start_pid_watcher(
    pid: u32,
    pty_id: u32,
    agent_name: String,
    app_handle: tauri::AppHandle,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
            let alive = if ret == 0 {
                true
            } else {
                // EPERM means process exists but we lack permission (shouldn't happen for children)
                std::io::Error::last_os_error().raw_os_error().unwrap_or(0) == libc::EPERM
            };
            if !alive {
                eprintln!("[pid-watcher] pid={pid} exited, emitting Stopped for pty={pty_id}");
                let _ = app_handle.emit(
                    "agent-status-changed",
                    AgentStatusPayload {
                        pty_id,
                        status: "stopped".to_string(),
                        agent_name: agent_name.clone(),
                        pid: 0,
                        sub_state: None,
                    },
                );
                if let Some(ws) = app_handle.try_state::<Mutex<AgentWatcherState>>() {
                    if let Ok(mut state) = ws.inner().lock() {
                        state.hook_states.remove(&pty_id);
                        // pid_watchers entry cleaned up lazily on PTY close
                    }
                }
                break;
            }
        }
    })
}

/// Update agent state from a hook event. Looks up `pty_id` by scanning
/// `PtyState.sessions` for the given `pane_id`. Emits `agent-status-changed`
/// only when the status actually changes.
pub fn set_hook_status(
    pane_id: &str,
    status: AgentStatus,
    sub_state: Option<String>,
    agent_name: &str,
    pid: Option<u32>,
    app_handle: &tauri::AppHandle,
    pty_state: &Mutex<crate::pty::PtyState>,
    watcher_state: &Mutex<AgentWatcherState>,
) {
    let pty_id = {
        let s = match pty_state.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        match s.pty_id_for_pane(pane_id) {
            Some(pid) => pid,
            None => {
                eprintln!("[hook] unknown pane_id: {pane_id}");
                return;
            }
        }
    };

    let (changed, should_start_watcher) = {
        let mut ws = match watcher_state.lock() {
            Ok(ws) => ws,
            Err(_) => return,
        };
        let prev = ws.hook_states.get(&pty_id);
        let changed = prev != Some(&status);
        if changed {
            ws.hook_states.insert(pty_id, status.clone());
        }
        // Cancel PID watcher when the agent stops normally (hook-based Stop)
        if changed && status == AgentStatus::Stopped {
            ws.cancel_pid_watcher(pty_id);
        }
        // Start a new PID watcher when Working fires with a valid PID
        let should_start = changed
            && status == AgentStatus::Working
            && pid.map(|p| p > 0).unwrap_or(false);
        if should_start {
            // Cancel any previous watcher before starting a new one
            ws.cancel_pid_watcher(pty_id);
        }
        (changed, should_start)
    };

    if changed {
        eprintln!(
            "[hook] state change: pane={pane_id} pty={pty_id} → {}",
            status.as_str()
        );
        let _ = app_handle.emit(
            "agent-status-changed",
            AgentStatusPayload {
                pty_id,
                status: status.as_str().to_string(),
                agent_name: agent_name.to_string(),
                pid: 0,
                sub_state,
            },
        );
    }

    // Start PID watcher outside the lock to avoid holding it during spawn.
    if should_start_watcher {
        if let Some(claude_pid) = pid {
            let handle = start_pid_watcher(
                claude_pid,
                pty_id,
                agent_name.to_string(),
                app_handle.clone(),
            );
            if let Ok(mut ws) = watcher_state.lock() {
                ws.pid_watchers.insert(pty_id, handle);
            }
        }
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn toggle_agent_manual(
    pty_id: u32,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _ = app.emit(
        "agent-manual-toggle",
        AgentStatusPayload {
            pty_id,
            status: "manual".to_string(),
            agent_name: "manual".to_string(),
            pid: 0,
            sub_state: None,
        },
    );
    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_status_as_str() {
        assert_eq!(AgentStatus::Working.as_str(), "working");
        assert_eq!(AgentStatus::Permission.as_str(), "permission");
        assert_eq!(AgentStatus::Stopped.as_str(), "stopped");
    }

    #[test]
    fn test_agent_status_payload_serialization() {
        let payload = AgentStatusPayload {
            pty_id: 1,
            status: "working".to_string(),
            agent_name: "claude".to_string(),
            pid: 42,
            sub_state: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["ptyId"], 1);
        assert_eq!(parsed["status"], "working");
        assert_eq!(parsed["agentName"], "claude");
        assert_eq!(parsed["pid"], 42);
        assert!(parsed.get("subState").is_none());
        assert!(parsed.get("pty_id").is_none());
        assert!(parsed.get("agent_name").is_none());
    }

    #[test]
    fn test_agent_status_payload_with_sub_state() {
        let payload = AgentStatusPayload {
            pty_id: 1,
            status: "permission".to_string(),
            agent_name: "claude".to_string(),
            pid: 0,
            sub_state: Some("Waiting for approval".to_string()),
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["subState"], "Waiting for approval");
    }

    #[test]
    fn test_agent_watcher_state_new() {
        let state = AgentWatcherState::new();
        assert!(state.hook_states.is_empty());
        assert!(state.pid_watchers.is_empty());
    }

    #[test]
    fn test_cancel_pid_watcher_noop_when_empty() {
        let mut state = AgentWatcherState::new();
        // Should not panic when no watcher is registered
        state.cancel_pid_watcher(999);
        assert!(state.pid_watchers.is_empty());
    }
}
