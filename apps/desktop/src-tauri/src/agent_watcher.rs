use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Emitter;

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Waiting,
    Idle,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentStatus::Running => "running",
            AgentStatus::Waiting => "waiting",
            AgentStatus::Idle => "idle",
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
}

// ── Known agents ───────────────────────────────────────────────────────

pub const DEFAULT_KNOWN_AGENTS: &[&str] = &["claude", "codex", "aider", "gemini"];

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

// ── Shared state ───────────────────────────────────────────────────────

pub struct AgentWatcherState {
    pub cancel_senders: HashMap<u32, tokio::sync::oneshot::Sender<()>>,
    pub last_outputs: HashMap<u32, Arc<AtomicU64>>,
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            cancel_senders: HashMap::new(),
            last_outputs: HashMap::new(),
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Walk the child process tree of `root_pid` looking for a known agent.
/// Returns (agent_name, agent_pid) if found.
/// Uses libproc to list children, then checks name and path of each.
fn find_agent_in_children(root_pid: u32) -> Option<(String, u32)> {
    // Get direct children of root_pid
    let children = match libproc::processes::pids_by_type(
        libproc::processes::ProcFilter::ByParentProcess { ppid: root_pid },
    ) {
        Ok(pids) => pids,
        Err(_) => return None,
    };

    for child_pid in &children {
        let pid = *child_pid as i32;

        // Check process name first (fast)
        if let Ok(name) = libproc::proc_pid::name(pid) {
            if let Some(agent) = is_known_agent(&name) {
                return Some((agent.to_string(), *child_pid));
            }
        }

        // Check executable path (catches cases where name is truncated or version-based)
        if let Ok(path) = libproc::proc_pid::pidpath(pid) {
            if let Some(agent) = is_known_agent(&path) {
                return Some((agent.to_string(), *child_pid));
            }
        }

        // Recurse into grandchildren (shell → subshell → agent)
        if let Some(found) = find_agent_in_children(*child_pid) {
            return Some(found);
        }
    }

    None
}

/// Silence threshold: if no output for this many ms, agent is "waiting".
const SILENCE_THRESHOLD_MS: u64 = 3_000;

/// Poll interval for process tree scanning.
const POLL_INTERVAL_MS: u64 = 2_000;

// ── Process-polling agent watcher ──────────────────────────────────────

/// Start watching a shell PID for agent child processes.
/// Polls every 2s using libproc to scan the process tree.
/// Uses last_output timestamp to distinguish running vs waiting.
pub fn start_watching(
    shell_pid: u32,
    pty_id: u32,
    app_handle: tauri::AppHandle,
    last_output: Arc<AtomicU64>,
    cancel: tokio::sync::oneshot::Receiver<()>,
) {
    tokio::spawn(async move {
        tokio::pin!(cancel);

        // Track last emitted status to avoid duplicate events
        let mut last_status: Option<AgentStatus> = None;
        let mut last_agent_name: Option<String> = None;

        loop {
            tokio::select! {
                _ = &mut cancel => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)) => {
                    // Scan child process tree for known agents
                    let agent = find_agent_in_children(shell_pid);

                    let (new_status, agent_name, agent_pid) = match agent {
                        Some((name, pid)) => {
                            // Agent found — check output activity
                            let last = last_output.load(Ordering::Relaxed);
                            let silence = now_millis().saturating_sub(last);

                            let status = if silence > SILENCE_THRESHOLD_MS {
                                AgentStatus::Waiting
                            } else {
                                AgentStatus::Running
                            };
                            (status, name, pid)
                        }
                        None => {
                            // No agent found
                            (AgentStatus::Idle, last_agent_name.clone().unwrap_or_default(), 0)
                        }
                    };

                    // Only emit if status changed
                    let status_changed = last_status.as_ref() != Some(&new_status);
                    let agent_changed = last_agent_name.as_deref() != Some(&agent_name);

                    if status_changed || agent_changed {
                        // Don't emit idle if we never detected an agent
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

    let last_output = watcher_state
        .last_outputs
        .get(&pty_id)
        .cloned()
        .unwrap_or_else(|| Arc::new(AtomicU64::new(now_millis())));

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    watcher_state.cancel_senders.insert(pty_id, cancel_tx);

    start_watching(shell_pid, pty_id, app, last_output, cancel_rx);
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
    watcher_state.last_outputs.remove(&pty_id);
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
            status: "running".to_string(),
            agent_name: "claude".to_string(),
            pid: 42,
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["ptyId"], 1);
        assert_eq!(parsed["status"], "running");
        assert_eq!(parsed["agentName"], "claude");
        assert_eq!(parsed["pid"], 42);

        // Verify camelCase (not snake_case)
        assert!(parsed.get("pty_id").is_none());
        assert!(parsed.get("agent_name").is_none());
    }

    #[test]
    fn test_default_known_agents_list() {
        assert_eq!(DEFAULT_KNOWN_AGENTS.len(), 4);
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"claude"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"codex"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"aider"));
        assert!(DEFAULT_KNOWN_AGENTS.contains(&"gemini"));
    }

    #[test]
    fn test_agent_status_as_str() {
        assert_eq!(AgentStatus::Running.as_str(), "running");
        assert_eq!(AgentStatus::Waiting.as_str(), "waiting");
        assert_eq!(AgentStatus::Idle.as_str(), "idle");
    }

    #[test]
    fn test_now_millis_is_reasonable() {
        let ms = now_millis();
        assert!(ms > 1_704_067_200_000);
    }

    #[test]
    fn test_agent_watcher_state_new() {
        let state = AgentWatcherState::new();
        assert!(state.cancel_senders.is_empty());
        assert!(state.last_outputs.is_empty());
    }

    #[test]
    fn test_find_agent_in_children_with_current_process() {
        // Our own process shouldn't have agent children
        let pid = std::process::id();
        let result = find_agent_in_children(pid);
        assert!(result.is_none());
    }

    #[test]
    fn test_find_agent_in_children_with_invalid_pid() {
        // Non-existent PID should return None gracefully
        let result = find_agent_in_children(999_999_999);
        assert!(result.is_none());
    }

    #[test]
    fn test_silence_threshold() {
        assert_eq!(SILENCE_THRESHOLD_MS, 3_000);
    }

    #[test]
    fn test_poll_interval() {
        assert_eq!(POLL_INTERVAL_MS, 2_000);
    }
}
