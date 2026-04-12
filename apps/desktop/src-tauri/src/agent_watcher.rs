use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    // Legacy states (silence-based detection) — kept during transition
    Running,
    Waiting,
    Idle,
    // Hook-based states
    Working,
    Permission,
    Stopped,
    Review,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentStatus::Running => "running",
            AgentStatus::Waiting => "waiting",
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
    /// Hook-based agent states, keyed by pty_id. When present for a given
    /// pty_id, the silence-based watcher suppresses its emissions (hook wins).
    pub hook_states: HashMap<u32, AgentStatus>,
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            cancel_senders: HashMap::new(),
            last_outputs: HashMap::new(),
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

/// Remove hook state for a pty_id (called when PTY is closed).
pub fn clear_hook_status(pty_id: u32, watcher_state: &Mutex<AgentWatcherState>) {
    if let Ok(mut ws) = watcher_state.lock() {
        ws.hook_states.remove(&pty_id);
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

/// Poll interval for process tree scanning when an agent may be present.
const POLL_INTERVAL_MS: u64 = 250;

/// Backed-off poll interval once a terminal has been consistently idle.
/// At 5s the watcher is nearly invisible; agent detection is still fast
/// because any found agent immediately resets idle_count to 0 (250ms polling).
const POLL_INTERVAL_IDLE_MS: u64 = 5_000;

/// Consecutive idle polls before switching to the backed-off interval.
/// 8 × 250ms = 2s of confirmed no-agent before slowing down.
const IDLE_BACKOFF_THRESHOLD: u32 = 8;

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
        // Consecutive idle poll count — drives adaptive backoff.
        let mut idle_count: u32 = 0;

        loop {
            // Back off to 2 s once we've been idle long enough; snap back immediately
            // when an agent is found. This cuts libproc syscalls from ~4/s to ~0.5/s
            // for terminals sitting at a shell prompt.
            let interval_ms = if idle_count >= IDLE_BACKOFF_THRESHOLD {
                POLL_INTERVAL_IDLE_MS
            } else {
                POLL_INTERVAL_MS
            };

            tokio::select! {
                _ = &mut cancel => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(interval_ms)) => {
                    // Scan child process tree for known agents.
                    // libproc syscalls block for ~50-100µs — run off the async executor.
                    let agent = tokio::task::spawn_blocking(move || find_agent_in_children(shell_pid))
                        .await
                        .unwrap_or(None);

                    let (new_status, agent_name, agent_pid) = match agent {
                        Some((name, pid)) => {
                            // Agent found — snap back to fast polling immediately.
                            idle_count = 0;
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
                            // No agent found — accumulate toward backoff threshold.
                            idle_count = idle_count.saturating_add(1);
                            (AgentStatus::Idle, last_agent_name.clone().unwrap_or_default(), 0)
                        }
                    };

                    // Hook state takes priority: if a hook-based state exists for
                    // this pty_id, suppress silence-based emissions entirely.
                    let hook_active = app_handle
                        .try_state::<Mutex<AgentWatcherState>>()
                        .and_then(|s| s.lock().ok().map(|ws| ws.hook_states.contains_key(&pty_id)))
                        .unwrap_or(false);
                    if hook_active {
                        continue;
                    }

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
            status: "running".to_string(),
            agent_name: "claude".to_string(),
            pid: 42,
            sub_state: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["ptyId"], 1);
        assert_eq!(parsed["status"], "running");
        assert_eq!(parsed["agentName"], "claude");
        assert_eq!(parsed["pid"], 42);
        // sub_state should be omitted when None
        assert!(parsed.get("subState").is_none());

        // Verify camelCase (not snake_case)
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
        assert_eq!(AgentStatus::Working.as_str(), "working");
        assert_eq!(AgentStatus::Permission.as_str(), "permission");
        assert_eq!(AgentStatus::Stopped.as_str(), "stopped");
        assert_eq!(AgentStatus::Review.as_str(), "review");
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
        assert!(state.hook_states.is_empty());
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
        assert_eq!(POLL_INTERVAL_MS, 250);
        assert_eq!(POLL_INTERVAL_IDLE_MS, 5_000);
        assert!(IDLE_BACKOFF_THRESHOLD > 0);
        // Idle interval must be strictly longer than the active interval.
        assert!(POLL_INTERVAL_IDLE_MS > POLL_INTERVAL_MS);
    }
}
