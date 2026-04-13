use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

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
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            hook_states: HashMap::new(),
        }
    }
}

/// Update agent state from a hook event. Looks up `pty_id` by scanning
/// `PtyState.sessions` for the given `pane_id`. Emits `agent-status-changed`
/// only when the status actually changes.
pub fn set_hook_status(
    pane_id: &str,
    status: AgentStatus,
    sub_state: Option<String>,
    agent_name: &str,
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

    let changed = {
        let mut ws = match watcher_state.lock() {
            Ok(ws) => ws,
            Err(_) => return,
        };
        let prev = ws.hook_states.get(&pty_id);
        if prev == Some(&status) {
            false
        } else {
            ws.hook_states.insert(pty_id, status.clone());
            true
        }
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
    }
}
