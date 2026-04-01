use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use kqueue::{EventData, EventFilter, FilterFlag, Ident, Proc, Watcher};
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
    fn as_str(&self) -> &'static str {
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

/// Check if a process name contains a known agent name (case-insensitive).
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

fn resolve_process_name(pid: i32) -> Option<String> {
    libproc::proc_pid::name(pid).ok()
}

/// Extract pid_t from kqueue Ident enum.
fn ident_to_pid(ident: &Ident) -> Option<i32> {
    match ident {
        Ident::Pid(pid) => Some(*pid),
        _ => None,
    }
}

// ── Silence detection (tokio timer) ────────────────────────────────────

fn start_silence_timer(
    pty_id: u32,
    last_output: Arc<AtomicU64>,
    agent_name: String,
    agent_pid: u32,
    app_handle: tauri::AppHandle,
    cancel: tokio::sync::oneshot::Receiver<()>,
) {
    tokio::spawn(async move {
        tokio::pin!(cancel);
        let mut was_waiting = false;
        let silence_threshold_ms: u64 = 15_000;

        loop {
            tokio::select! {
                _ = &mut cancel => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    let last = last_output.load(Ordering::Relaxed);
                    let elapsed = now_millis().saturating_sub(last);

                    if elapsed > silence_threshold_ms && !was_waiting {
                        was_waiting = true;
                        let _ = app_handle.emit(
                            "agent-status-changed",
                            AgentStatusPayload {
                                pty_id,
                                status: AgentStatus::Waiting.as_str().to_string(),
                                agent_name: agent_name.clone(),
                                pid: agent_pid,
                            },
                        );
                    } else if elapsed <= silence_threshold_ms && was_waiting {
                        was_waiting = false;
                        let _ = app_handle.emit(
                            "agent-status-changed",
                            AgentStatusPayload {
                                pty_id,
                                status: AgentStatus::Running.as_str().to_string(),
                                agent_name: agent_name.clone(),
                                pid: agent_pid,
                            },
                        );
                    }
                }
            }
        }
    });
}

// ── Kqueue watcher ─────────────────────────────────────────────────────

/// Start watching a shell PID for agent child processes.
/// Spawns a dedicated std::thread (blocking kqueue loop).
pub fn start_watching(
    shell_pid: u32,
    pty_id: u32,
    app_handle: tauri::AppHandle,
    last_output: Arc<AtomicU64>,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) {
    std::thread::spawn(move || {
        let mut watcher = match Watcher::new() {
            Ok(w) => w,
            Err(_) => return,
        };

        // Watch the shell process for fork/exec/exit + NOTE_TRACK for child tracking
        if watcher
            .add_pid(
                shell_pid as i32,
                EventFilter::EVFILT_PROC,
                FilterFlag::NOTE_FORK
                    | FilterFlag::NOTE_EXEC
                    | FilterFlag::NOTE_EXIT
                    | FilterFlag::NOTE_TRACK,
            )
            .is_err()
        {
            return;
        }

        if watcher.watch().is_err() {
            return;
        }

        // Track detected agent for this PTY
        let mut detected_agent: Option<(String, u32)> = None; // (name, pid)
        let mut silence_cancel: Option<tokio::sync::oneshot::Sender<()>> = None;

        // Use poll_forever instead of iter() to allow mutable access to watcher
        // for adding child PIDs dynamically
        loop {
            // Check cancellation
            if cancel_rx.try_recv().is_ok() {
                break;
            }

            // Block until next event (no timeout = wait forever)
            let event = match watcher.poll_forever(None) {
                Some(ev) => ev,
                None => continue,
            };

            let event_pid = ident_to_pid(&event.ident).unwrap_or(0);
            let mut should_break = false;

            // Collect child PIDs to add after processing
            let mut new_child_pid: Option<i32> = None;

            match event.data {
                EventData::Proc(ref proc_event) => {
                    match proc_event {
                        Proc::Fork => {
                            // Shell or child forked -- NOTE_TRACK handles child registration
                        }

                        Proc::Track(child_pid) | Proc::Child(child_pid) => {
                            // kqueue reported a new child process -- add watcher
                            new_child_pid = Some(*child_pid);
                        }

                        Proc::Exec => {
                            // Process exec'd -- resolve name and check known agents
                            if let Some(name) = resolve_process_name(event_pid) {
                                if let Some(agent_name) = is_known_agent(&name) {
                                    if detected_agent.is_none() {
                                        detected_agent =
                                            Some((agent_name.to_string(), event_pid as u32));

                                        let _ = app_handle.emit(
                                            "agent-status-changed",
                                            AgentStatusPayload {
                                                pty_id,
                                                status: AgentStatus::Running
                                                    .as_str()
                                                    .to_string(),
                                                agent_name: agent_name.to_string(),
                                                pid: event_pid as u32,
                                            },
                                        );

                                        // Start silence detection timer
                                        let (tx, rx) = tokio::sync::oneshot::channel();
                                        silence_cancel = Some(tx);
                                        start_silence_timer(
                                            pty_id,
                                            last_output.clone(),
                                            agent_name.to_string(),
                                            event_pid as u32,
                                            app_handle.clone(),
                                            rx,
                                        );
                                    }
                                }
                            }
                        }

                        Proc::Exit(_) => {
                            // Check if the exiting process is our detected agent
                            if let Some((ref agent_name, agent_pid)) = detected_agent {
                                if event_pid == agent_pid as i32 {
                                    let _ = app_handle.emit(
                                        "agent-status-changed",
                                        AgentStatusPayload {
                                            pty_id,
                                            status: AgentStatus::Idle.as_str().to_string(),
                                            agent_name: agent_name.clone(),
                                            pid: agent_pid,
                                        },
                                    );

                                    // Stop silence timer
                                    if let Some(cancel) = silence_cancel.take() {
                                        let _ = cancel.send(());
                                    }

                                    detected_agent = None;
                                }
                            }

                            // If the shell itself exited, stop watching
                            if event_pid == shell_pid as i32 {
                                should_break = true;
                            }
                        }

                        Proc::Trackerr => {
                            // Could not track a child -- non-fatal, continue.
                        }
                    }
                }
                _ => {}
            }

            // Add child watcher after releasing event borrow
            if let Some(child_pid) = new_child_pid {
                let _ = watcher.add_pid(
                    child_pid,
                    EventFilter::EVFILT_PROC,
                    FilterFlag::NOTE_FORK
                        | FilterFlag::NOTE_EXEC
                        | FilterFlag::NOTE_EXIT
                        | FilterFlag::NOTE_TRACK,
                );
                let _ = watcher.watch();
            }

            if should_break {
                break;
            }
        }

        // Cleanup: stop silence timer if running
        if let Some(cancel) = silence_cancel.take() {
            let _ = cancel.send(());
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
    fn test_agent_status_payload_serialization() {
        let payload = AgentStatusPayload {
            pty_id: 1,
            status: "running".to_string(),
            agent_name: "claude".to_string(),
            pid: 42,
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase keys (NOT snake_case)
        assert_eq!(parsed["ptyId"], 1);
        assert_eq!(parsed["status"], "running");
        assert_eq!(parsed["agentName"], "claude");
        assert_eq!(parsed["pid"], 42);

        // Verify snake_case keys are NOT present
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
        // Should be after 2024-01-01 in milliseconds
        assert!(ms > 1_704_067_200_000);
    }

    #[test]
    fn test_agent_watcher_state_new() {
        let state = AgentWatcherState::new();
        assert!(state.cancel_senders.is_empty());
        assert!(state.last_outputs.is_empty());
    }
}
