use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Working,
    Permission,
    Stopped,
    #[allow(dead_code)]
    Review,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentStatus::Idle => "idle",
            AgentStatus::Working => "working",
            AgentStatus::Permission => "permission",
            AgentStatus::Stopped => "stopped",
            AgentStatus::Review => "review",
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

// ── Known agents ───────────────────────────────────────────────────────

pub const DEFAULT_KNOWN_AGENTS: &[&str] = &["claude", "codex", "aider", "gemini", "mastracode"];

/// Agents that support hook-based state reporting. The process watcher emits
/// `Idle` (not `Working`) when it detects these — hooks are the source of truth.
const HOOK_CAPABLE_AGENTS: &[&str] = &["claude", "codex", "gemini", "mastracode"];

/// Check if a process name or path contains a known agent name (case-insensitive).
/// Returns the matched agent name if found.
pub fn is_known_agent(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    for &agent in DEFAULT_KNOWN_AGENTS {
        if lower.contains(agent) {
            return Some(agent);
        }
    }
    None
}

/// Returns true if the agent supports hooks and should not be marked `Working`
/// by the process watcher alone.
fn is_hook_capable(agent_name: &str) -> bool {
    HOOK_CAPABLE_AGENTS.iter().any(|&a| agent_name == a)
}

// ── Shared state ───────────────────────────────────────────────────────

pub struct AgentWatcherState {
    pub cancel_senders: HashMap<u32, tokio::sync::oneshot::Sender<()>>,
    /// Hook-based agent states, keyed by pty_id.
    pub hook_states: HashMap<u32, AgentStatus>,
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            cancel_senders: HashMap::new(),
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
    // Resolve pane_id → pty_id via PtyState accessor
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

// ── Helpers ────────────────────────────────────────────────────────────

/// Walk the child process tree of `root_pid` looking for a known agent.
/// Returns (agent_name, agent_pid) if found.
/// Uses libproc to list children, then checks name and path of each.
fn find_agent_in_children(root_pid: u32) -> Option<(String, u32)> {
    let children = match libproc::processes::pids_by_type(
        libproc::processes::ProcFilter::ByParentProcess { ppid: root_pid },
    ) {
        Ok(pids) => pids,
        Err(_) => return None,
    };

    for child_pid in &children {
        let pid = *child_pid as i32;

        if let Ok(name) = libproc::proc_pid::name(pid) {
            if let Some(agent) = is_known_agent(&name) {
                return Some((agent.to_string(), *child_pid));
            }
        }

        if let Ok(path) = libproc::proc_pid::pidpath(pid) {
            if let Some(agent) = is_known_agent(&path) {
                return Some((agent.to_string(), *child_pid));
            }
        }

        if let Some(found) = find_agent_in_children(*child_pid) {
            return Some(found);
        }
    }

    None
}

/// Poll interval for process-based watcher (Aider fallback).
const PROCESS_POLL_MS: u64 = 500;

/// Backed-off poll interval when no agent is detected.
const PROCESS_POLL_IDLE_MS: u64 = 5_000;

/// Consecutive idle polls before backing off.
const IDLE_BACKOFF_THRESHOLD: u32 = 8;

// ── Process-based watcher (Aider fallback) ─────────────────────────────

/// Start a process-tree watcher for agents without hook support (Aider).
/// No silence threshold — agent found = Working, agent gone = Idle.
///
/// **Hook priority:** once the hook system has claimed this pty_id (i.e.
/// `hook_states` contains an entry), the process watcher suppresses its
/// emissions and lets hooks be the sole source of truth. This prevents
/// the watcher from overwriting hook-driven states like `Stopped` or
/// `Permission` with `Working` just because the agent process is alive.
pub fn start_process_watcher(
    shell_pid: u32,
    pty_id: u32,
    app_handle: tauri::AppHandle,
    cancel: tokio::sync::oneshot::Receiver<()>,
) {
    tokio::spawn(async move {
        tokio::pin!(cancel);

        let mut last_status: Option<AgentStatus> = None;
        let mut last_agent_name: Option<String> = None;
        let mut idle_count: u32 = 0;

        loop {
            let interval_ms = if idle_count >= IDLE_BACKOFF_THRESHOLD {
                PROCESS_POLL_IDLE_MS
            } else {
                PROCESS_POLL_MS
            };

            tokio::select! {
                _ = &mut cancel => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(interval_ms)) => {
                    // If the hook system has claimed this pty_id, suppress
                    // process-watcher emissions — hooks are the source of truth.
                    if let Some(ws) = app_handle.try_state::<Mutex<AgentWatcherState>>() {
                        if let Ok(guard) = ws.lock() {
                            if guard.hook_states.contains_key(&pty_id) {
                                continue;
                            }
                        }
                    }

                    let agent = tokio::task::spawn_blocking(move || find_agent_in_children(shell_pid))
                        .await
                        .unwrap_or(None);

                    let (new_status, agent_name, agent_pid) = match agent {
                        Some((name, pid)) => {
                            idle_count = 0;
                            // Hook-capable agents: emit Idle (registers agent name/icon)
                            // but let hooks drive Working/Permission/Stopped transitions.
                            // Non-hook agents (aider): emit Working directly.
                            let status = if is_hook_capable(&name) {
                                AgentStatus::Idle
                            } else {
                                AgentStatus::Working
                            };
                            (status, name, pid)
                        }
                        None => {
                            idle_count = idle_count.saturating_add(1);
                            (AgentStatus::Idle, last_agent_name.clone().unwrap_or_default(), 0)
                        }
                    };

                    let status_changed = last_status.as_ref() != Some(&new_status);
                    let agent_changed = last_agent_name.as_deref() != Some(&agent_name);

                    if status_changed || agent_changed {
                        if new_status == AgentStatus::Idle && last_status.is_none() {
                            continue;
                        }

                        let _ = app_handle.emit(
                            "agent-status-changed",
                            AgentStatusPayload {
                                pty_id,
                                status: new_status.as_str().to_string(),
                                agent_name: agent_name.clone(),
                                pid: agent_pid,
                                sub_state: None,
                            },
                        );

                        last_status = Some(new_status);
                        if !agent_name.is_empty() {
                            last_agent_name = Some(agent_name);
                        }
                    }
                }
            }
        }
    });
}

// ── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn start_agent_watching(
    pty_id: u32,
    shell_pid: u32,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    let mut watcher_state = state.lock().map_err(|e| e.to_string())?;

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    watcher_state.cancel_senders.insert(pty_id, cancel_tx);

    start_process_watcher(shell_pid, pty_id, app, cancel_rx);
    Ok(())
}

#[tauri::command]
pub fn stop_agent_watching(
    pty_id: u32,
    state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    let mut watcher_state = state.lock().map_err(|e| e.to_string())?;
    if let Some(cancel) = watcher_state.cancel_senders.remove(&pty_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

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
    fn test_is_known_agent_matches() {
        assert_eq!(is_known_agent("claude"), Some("claude"));
        assert_eq!(is_known_agent("node"), None);
        assert_eq!(is_known_agent("CLAUDE"), Some("claude"));
    }

    #[test]
    fn test_is_known_agent_partial_match() {
        assert_eq!(is_known_agent("claude-code"), Some("claude"));
        assert_eq!(is_known_agent("aider-chat"), Some("aider"));
        assert_eq!(is_known_agent("my-codex-wrapper"), Some("codex"));
    }

    #[test]
    fn test_is_known_agent_path_match() {
        assert_eq!(
            is_known_agent("/Users/pierre/.local/bin/claude"),
            Some("claude")
        );
        assert_eq!(
            is_known_agent("/usr/local/bin/aider"),
            Some("aider")
        );
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
    fn test_default_known_agents_list() {
        assert_eq!(DEFAULT_KNOWN_AGENTS.len(), 5);
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"claude"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"codex"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"aider"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"gemini"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"mastracode"));
    }

    #[test]
    fn test_hook_capable_agents() {
        assert!(is_hook_capable("claude"));
        assert!(is_hook_capable("codex"));
        assert!(is_hook_capable("gemini"));
        assert!(is_hook_capable("mastracode"));
        assert!(!is_hook_capable("aider"));
        assert!(!is_hook_capable("unknown"));
    }

    #[test]
    fn test_agent_status_as_str() {
        assert_eq!(AgentStatus::Idle.as_str(), "idle");
        assert_eq!(AgentStatus::Working.as_str(), "working");
        assert_eq!(AgentStatus::Permission.as_str(), "permission");
        assert_eq!(AgentStatus::Stopped.as_str(), "stopped");
        assert_eq!(AgentStatus::Review.as_str(), "review");
    }

    #[test]
    fn test_agent_watcher_state_new() {
        let state = AgentWatcherState::new();
        assert!(state.cancel_senders.is_empty());
        assert!(state.hook_states.is_empty());
    }

    #[test]
    fn test_find_agent_in_children_with_current_process() {
        let pid = std::process::id();
        let result = find_agent_in_children(pid);
        assert!(result.is_none());
    }

    #[test]
    fn test_find_agent_in_children_with_invalid_pid() {
        let result = find_agent_in_children(999_999_999);
        assert!(result.is_none());
    }

    #[test]
    fn test_process_poll_intervals() {
        assert_eq!(PROCESS_POLL_MS, 500);
        assert_eq!(PROCESS_POLL_IDLE_MS, 5_000);
        assert!(IDLE_BACKOFF_THRESHOLD > 0);
        assert!(PROCESS_POLL_IDLE_MS > PROCESS_POLL_MS);
    }
}
