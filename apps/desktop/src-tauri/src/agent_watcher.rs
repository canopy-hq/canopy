use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
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

// ── Output-based agent detection ──────────────────────────────────────

/// Agent output signatures: (agent_name, list of byte patterns to match).
/// Any single pattern match triggers detection.
const AGENT_OUTPUT_PATTERNS: &[(&str, &[&[u8]])] = &[
    ("claude", &[b"Claude Code", b"claude\xe2\x80\xba"]),
    ("aider", &[b"Aider v", b"aider>"]),
    ("codex", &[b"OpenAI Codex", b"codex>"]),
    ("gemini", &[b"Gemini Code", b"gemini>"]),
];

/// Shell prompt patterns that indicate an agent has exited and the user
/// is back at a normal shell prompt.
/// Shell prompt endings that indicate the user is back at a shell.
/// These are matched ONLY after a newline boundary in the window
/// (enforced by `contains_bytes_after_newline`).
const SHELL_PROMPT_PATTERNS: &[&[u8]] = &[
    b"$ ",
    b"% ",
    b"# ",
    b"\xe2\x9d\xaf ",  // ❯  (zsh starship etc.)
];

/// Agent-specific input prompt patterns that indicate the agent is waiting
/// for user input. Matched only when in Running state for the corresponding agent.
const AGENT_PROMPT_PATTERNS: &[(&str, &[&[u8]])] = &[
    ("claude", &[b"\xe2\x9d\xaf", b"? "]),  // ❯ chevron, question prompt
    ("aider", &[b"aider> "]),
    ("codex", &[b"codex> "]),
    ("gemini", &[b"gemini> "]),
];

/// Events emitted by the output-based detector.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentDetectionEvent {
    Started { agent_name: String },
    Waiting { agent_name: String },
    Stopped { agent_name: String },
}

#[derive(Debug, Clone, PartialEq)]
enum DetectionState {
    Idle,
    Running { agent_name: String },
    PromptSeen { agent_name: String, seen_at: u64 },
}

/// Per-PTY detector that scans raw terminal output bytes for agent
/// signatures and shell prompt returns.  Uses a small ring buffer so
/// patterns split across two `read()` calls are still matched.
pub struct OutputAgentDetector {
    state: DetectionState,
    ring_buf: Vec<u8>,
    ring_pos: usize,
    capacity: usize,
    /// Timestamp (ms since epoch) of the last state transition.
    last_transition_ms: u64,
    /// After Started, ignore Stopped events for this many ms.
    started_cooldown_ms: u64,
    /// After Stopped, ignore Started events for this many ms.
    stopped_cooldown_ms: u64,
}

impl OutputAgentDetector {
    pub fn new() -> Self {
        let capacity = 1024;
        Self {
            state: DetectionState::Idle,
            ring_buf: vec![0u8; capacity],
            ring_pos: 0,
            capacity,
            last_transition_ms: 0,
            started_cooldown_ms: 3000,
            stopped_cooldown_ms: 1000,
        }
    }

    /// Create a detector with custom cooldown values (for testing).
    #[cfg(test)]
    pub fn with_cooldowns(started_ms: u64, stopped_ms: u64) -> Self {
        let mut det = Self::new();
        det.started_cooldown_ms = started_ms;
        det.stopped_cooldown_ms = stopped_ms;
        det
    }

    /// Feed raw bytes from the PTY reader.  Returns `Some(event)` on a
    /// state transition, `None` otherwise.
    pub fn feed(&mut self, bytes: &[u8]) -> Option<AgentDetectionEvent> {
        // Append bytes to ring buffer (overwrite oldest when full)
        for &b in bytes {
            self.ring_buf[self.ring_pos % self.capacity] = b;
            self.ring_pos += 1;
        }

        let window = self.window();
        let now = now_millis();
        let elapsed = now.saturating_sub(self.last_transition_ms);

        match &self.state {
            DetectionState::Idle => {
                // Scan for agent startup patterns
                for &(agent_name, patterns) in AGENT_OUTPUT_PATTERNS {
                    for &pattern in patterns {
                        if contains_bytes(&window, pattern) {
                            // Debounce: after Stopped, ignore Started for stopped_cooldown_ms
                            if self.last_transition_ms > 0 && elapsed < self.stopped_cooldown_ms {
                                return None;
                            }
                            self.state = DetectionState::Running {
                                agent_name: agent_name.to_string(),
                            };
                            self.last_transition_ms = now;
                            self.clear_ring();
                            return Some(AgentDetectionEvent::Started {
                                agent_name: agent_name.to_string(),
                            });
                        }
                    }
                }
                None
            }
            DetectionState::Running { agent_name } => {
                // Scan for shell prompt return (newline-anchored)
                for &pattern in SHELL_PROMPT_PATTERNS {
                    if contains_bytes_after_newline(&window, pattern) {
                        // Debounce: after Started, ignore Stopped for started_cooldown_ms
                        if elapsed < self.started_cooldown_ms {
                            return None;
                        }
                        let name = agent_name.clone();
                        self.state = DetectionState::Idle;
                        self.last_transition_ms = now;
                        self.clear_ring();
                        return Some(AgentDetectionEvent::Stopped { agent_name: name });
                    }
                }

                // Check for agent prompt patterns (waiting indicator)
                let agent = agent_name.clone();
                for &(pname, patterns) in AGENT_PROMPT_PATTERNS {
                    if pname != agent {
                        continue;
                    }
                    for &pattern in patterns {
                        if contains_bytes(&window, pattern) {
                            self.state = DetectionState::PromptSeen {
                                agent_name: agent,
                                seen_at: now,
                            };
                            self.clear_ring();
                            return None;
                        }
                    }
                }
                None
            }
            DetectionState::PromptSeen { agent_name, .. } => {
                let agent = agent_name.clone();
                // Shell prompt -> Idle + Stopped
                for &pattern in SHELL_PROMPT_PATTERNS {
                    if contains_bytes_after_newline(&window, pattern) {
                        // Respect started_cooldown from the original Running->PromptSeen transition
                        if elapsed < self.started_cooldown_ms {
                            return None;
                        }
                        self.state = DetectionState::Idle;
                        self.last_transition_ms = now;
                        self.clear_ring();
                        return Some(AgentDetectionEvent::Stopped { agent_name: agent });
                    }
                }

                // Another agent prompt -> reset seen_at
                for &(pname, patterns) in AGENT_PROMPT_PATTERNS {
                    if pname != agent {
                        continue;
                    }
                    for &pattern in patterns {
                        if contains_bytes(&window, pattern) {
                            self.state = DetectionState::PromptSeen {
                                agent_name: agent,
                                seen_at: now,
                            };
                            self.clear_ring();
                            return None;
                        }
                    }
                }

                // Any other output -> back to Running (agent resumed)
                // Only if we actually received non-empty bytes
                if !bytes.is_empty() {
                    self.state = DetectionState::Running { agent_name: agent.clone() };
                    self.clear_ring();
                    return Some(AgentDetectionEvent::Started { agent_name: agent });
                }
                None
            }
        }
    }

    /// Check if the detector is in PromptSeen state and enough time has
    /// elapsed (>= 2000ms) to consider the agent "waiting" for user input.
    /// Returns `Some(Waiting)` if so, `None` otherwise.
    /// Does NOT transition state -- stays in PromptSeen.
    pub fn check_waiting(&self) -> Option<AgentDetectionEvent> {
        if let DetectionState::PromptSeen { ref agent_name, seen_at } = self.state {
            let elapsed = now_millis().saturating_sub(seen_at);
            if elapsed >= 2000 {
                return Some(AgentDetectionEvent::Waiting {
                    agent_name: agent_name.clone(),
                });
            }
        }
        None
    }

    /// Set the last transition timestamp (test helper to simulate elapsed time).
    #[cfg(test)]
    fn set_last_transition(&mut self, ms: u64) {
        self.last_transition_ms = ms;
    }

    /// Force set the state to PromptSeen with a specific seen_at (test helper).
    #[cfg(test)]
    fn set_prompt_seen(&mut self, agent_name: &str, seen_at: u64) {
        self.state = DetectionState::PromptSeen {
            agent_name: agent_name.to_string(),
            seen_at,
        };
    }

    /// Clear the ring buffer after a state transition so stale patterns
    /// don't cause false matches on the next scan.
    fn clear_ring(&mut self) {
        self.ring_buf.fill(0);
        self.ring_pos = 0;
    }

    /// Return the current contents of the ring buffer in order.
    fn window(&self) -> Vec<u8> {
        if self.ring_pos <= self.capacity {
            // Haven't wrapped yet
            self.ring_buf[..self.ring_pos].to_vec()
        } else {
            let start = self.ring_pos % self.capacity;
            let mut out = Vec::with_capacity(self.capacity);
            out.extend_from_slice(&self.ring_buf[start..]);
            out.extend_from_slice(&self.ring_buf[..start]);
            out
        }
    }
}

/// Simple byte-substring search (no regex overhead).
fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Check if needle appears in haystack, but only at positions that are
/// on a new line (preceded by `\n` somewhere earlier in the haystack).
/// This prevents matching `$ ` or `% ` that appear mid-line in agent output.
fn contains_bytes_after_newline(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    // Find each occurrence of needle and check if a newline precedes it
    for (i, w) in haystack.windows(needle.len()).enumerate() {
        if w == needle {
            // Check if there's a newline anywhere in haystack[..i]
            if haystack[..i].contains(&b'\n') {
                return true;
            }
        }
    }
    false
}

// ── Shared state ───────────────────────────────────────────────────────

pub struct AgentWatcherState {
    pub cancel_senders: HashMap<u32, tokio::sync::oneshot::Sender<()>>,
    pub last_outputs: HashMap<u32, Arc<AtomicU64>>,
    pub detectors: HashMap<u32, Arc<Mutex<OutputAgentDetector>>>,
}

impl AgentWatcherState {
    pub fn new() -> Self {
        Self {
            cancel_senders: HashMap::new(),
            last_outputs: HashMap::new(),
            detectors: HashMap::new(),
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

// ── Prompt-based waiting detection (tokio timer) ──────────────────────

fn start_silence_timer(
    pty_id: u32,
    detector: Arc<Mutex<OutputAgentDetector>>,
    app_handle: tauri::AppHandle,
    cancel: tokio::sync::oneshot::Receiver<()>,
) {
    tokio::spawn(async move {
        tokio::pin!(cancel);
        let mut was_waiting = false;

        loop {
            tokio::select! {
                _ = &mut cancel => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    if let Ok(det) = detector.lock() {
                        if let Some(AgentDetectionEvent::Waiting { ref agent_name }) = det.check_waiting() {
                            if !was_waiting {
                                was_waiting = true;
                                let _ = app_handle.emit(
                                    "agent-status-changed",
                                    AgentStatusPayload {
                                        pty_id,
                                        status: AgentStatus::Waiting.as_str().to_string(),
                                        agent_name: agent_name.clone(),
                                        pid: 0,
                                    },
                                );
                            }
                        } else {
                            // State changed away from PromptSeen (or not yet 2s)
                            was_waiting = false;
                        }
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
    detector: Arc<Mutex<OutputAgentDetector>>,
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

                                        // Start prompt-based waiting detection timer
                                        let (tx, rx) = tokio::sync::oneshot::channel();
                                        silence_cancel = Some(tx);
                                        start_silence_timer(
                                            pty_id,
                                            detector.clone(),
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

    let detector = watcher_state
        .detectors
        .entry(pty_id)
        .or_insert_with(|| Arc::new(Mutex::new(OutputAgentDetector::new())))
        .clone();

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    watcher_state.cancel_senders.insert(pty_id, cancel_tx);

    start_watching(shell_pid, pty_id, app, detector, cancel_rx);
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

    // ── OutputAgentDetector tests ─────────────────────────────────────

    #[test]
    fn test_output_detector_detects_claude() {
        let mut det = OutputAgentDetector::new();
        let result = det.feed(b"Welcome to Claude Code v4.0\n");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Started {
                agent_name: "claude".to_string()
            })
        );
    }

    #[test]
    fn test_output_detector_detects_aider() {
        let mut det = OutputAgentDetector::new();
        let result = det.feed(b"aider> /help\n");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Started {
                agent_name: "aider".to_string()
            })
        );
    }

    #[test]
    fn test_output_detector_detects_shell_return() {
        let mut det = OutputAgentDetector::new();
        // Start an agent first
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Simulate time passing beyond cooldown
        det.set_last_transition(now_millis() - 4000);

        // Now simulate returning to shell prompt (newline-prefixed)
        let result = det.feed(b"\nuser@host$ ");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Stopped {
                agent_name: "claude".to_string()
            })
        );
    }

    #[test]
    fn test_output_detector_ignores_normal_output() {
        let mut det = OutputAgentDetector::new();
        let result = det.feed(b"ls\nfoo.txt\nbar.txt\n");
        assert_eq!(result, None);
    }

    #[test]
    fn test_output_detector_split_pattern() {
        let mut det = OutputAgentDetector::new();
        // First chunk: partial pattern
        let result1 = det.feed(b"Welcome to Clau");
        assert_eq!(result1, None);

        // Second chunk: completes the pattern
        let result2 = det.feed(b"de Code v1");
        assert_eq!(
            result2,
            Some(AgentDetectionEvent::Started {
                agent_name: "claude".to_string()
            })
        );
    }

    #[test]
    fn test_output_detector_no_false_stop_in_idle() {
        let mut det = OutputAgentDetector::new();
        // Shell prompt in Idle state should NOT trigger a stop
        let result = det.feed(b"user@host $ ");
        assert_eq!(result, None);
    }

    #[test]
    fn test_output_detector_full_cycle() {
        let mut det = OutputAgentDetector::new();

        // Start claude
        let r1 = det.feed(b"Claude Code v4.0\n");
        assert_eq!(r1, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));

        // Simulate time passing beyond cooldown
        det.set_last_transition(now_millis() - 4000);

        // Stop claude (back to shell)
        let r2 = det.feed(b"\nuser@host $ ");
        assert_eq!(r2, Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() }));

        // Simulate time passing beyond stopped cooldown
        det.set_last_transition(now_millis() - 2000);

        // Start aider
        let r3 = det.feed(b"Aider v0.50.0\n");
        assert_eq!(r3, Some(AgentDetectionEvent::Started { agent_name: "aider".to_string() }));

        // Simulate time passing beyond cooldown
        det.set_last_transition(now_millis() - 4000);

        // Stop aider
        let r4 = det.feed(b"\nuser@host% ");
        assert_eq!(r4, Some(AgentDetectionEvent::Stopped { agent_name: "aider".to_string() }));
    }

    // ── False positive resistance tests ──────────────────────────────

    #[test]
    fn test_no_false_stop_on_markdown_header() {
        let mut det = OutputAgentDetector::new();
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Markdown header with # should NOT trigger Stopped
        let result = det.feed(b"# This is a markdown header");
        assert_eq!(result, None);
    }

    #[test]
    fn test_no_false_stop_on_dollar_midline() {
        let mut det = OutputAgentDetector::new();
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Mid-line dollar sign should NOT trigger Stopped
        let result = det.feed(b"Run $ npm install to fix");
        assert_eq!(result, None);
    }

    #[test]
    fn test_no_false_stop_on_quoted_text() {
        let mut det = OutputAgentDetector::new();
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Quoted text with > should NOT trigger Stopped
        let result = det.feed(b"> quoted text from agent");
        assert_eq!(result, None);
    }

    #[test]
    fn test_newline_dollar_prompt_triggers_stop() {
        let mut det = OutputAgentDetector::new();
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Simulate time past cooldown
        det.set_last_transition(now_millis() - 4000);

        let result = det.feed(b"\nuser@host$ ");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() })
        );
    }

    #[test]
    fn test_newline_percent_prompt_triggers_stop() {
        let mut det = OutputAgentDetector::new();
        det.feed(b"Claude Code v4.0");
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });

        // Simulate time past cooldown
        det.set_last_transition(now_millis() - 4000);

        let result = det.feed(b"\nuser@host% ");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() })
        );
    }

    #[test]
    fn test_bare_gemini_does_not_trigger_start() {
        let mut det = OutputAgentDetector::new();
        // Bare "Gemini" should NOT trigger Started (too generic)
        let result = det.feed(b"Gemini");
        assert_eq!(result, None);
    }

    #[test]
    fn test_gemini_code_triggers_start() {
        let mut det = OutputAgentDetector::new();
        let result = det.feed(b"Gemini Code Assist");
        assert_eq!(
            result,
            Some(AgentDetectionEvent::Started { agent_name: "gemini".to_string() })
        );
    }

    #[test]
    fn test_standalone_chevron_does_not_trigger_start() {
        let mut det = OutputAgentDetector::new();
        // Standalone Unicode chevron should NOT trigger Started
        let result = det.feed(b"\xe2\x80\xba");
        assert_eq!(result, None);
    }

    #[test]
    fn test_split_pattern_with_1024_buffer() {
        let mut det = OutputAgentDetector::new();
        assert_eq!(det.capacity, 1024);

        // Feed partial pattern
        let r1 = det.feed(b"Welcome to Clau");
        assert_eq!(r1, None);

        // Complete pattern
        let r2 = det.feed(b"de Code v1");
        assert_eq!(
            r2,
            Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() })
        );
    }

    // ── Debounce tests ───────────────────────────────────────────────

    #[test]
    fn test_debounce_stop_within_cooldown_is_suppressed() {
        let mut det = OutputAgentDetector::with_cooldowns(3000, 1000);
        // Start agent -- this sets last_transition_ms to now
        let r = det.feed(b"Claude Code v4.0");
        assert_eq!(r, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));

        // Immediately feed shell prompt (within 3s cooldown) -- should be suppressed
        let r2 = det.feed(b"\nuser@host$ ");
        assert_eq!(r2, None);
        // State should still be Running
        assert_eq!(det.state, DetectionState::Running { agent_name: "claude".to_string() });
    }

    #[test]
    fn test_debounce_stop_after_cooldown_succeeds() {
        let mut det = OutputAgentDetector::with_cooldowns(3000, 1000);
        let r = det.feed(b"Claude Code v4.0");
        assert_eq!(r, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));

        // Simulate 4 seconds elapsed by setting last_transition to the past
        det.set_last_transition(now_millis() - 4000);

        let r2 = det.feed(b"\nuser@host$ ");
        assert_eq!(r2, Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() }));
    }

    #[test]
    fn test_debounce_start_within_cooldown_is_suppressed() {
        let mut det = OutputAgentDetector::with_cooldowns(3000, 1000);
        // Start then stop agent
        det.feed(b"Claude Code v4.0");
        det.set_last_transition(now_millis() - 4000); // past cooldown
        det.feed(b"\nuser@host$ ");
        assert_eq!(det.state, DetectionState::Idle);

        // Immediately feed agent pattern (within 1s stopped cooldown) -- suppressed
        let r = det.feed(b"Aider v0.50.0");
        assert_eq!(r, None);
        assert_eq!(det.state, DetectionState::Idle);
    }

    #[test]
    fn test_debounce_start_after_cooldown_succeeds() {
        let mut det = OutputAgentDetector::with_cooldowns(3000, 1000);
        // Start then stop agent
        det.feed(b"Claude Code v4.0");
        det.set_last_transition(now_millis() - 4000);
        det.feed(b"\nuser@host$ ");
        assert_eq!(det.state, DetectionState::Idle);

        // Simulate 2 seconds after stop
        det.set_last_transition(now_millis() - 2000);

        let r = det.feed(b"Aider v0.50.0");
        assert_eq!(r, Some(AgentDetectionEvent::Started { agent_name: "aider".to_string() }));
    }

    #[test]
    fn test_debounce_normal_operation_works() {
        // With long gaps between transitions, everything works normally
        let mut det = OutputAgentDetector::with_cooldowns(3000, 1000);

        // First start -- no previous transition (last_transition_ms=0), no cooldown
        let r1 = det.feed(b"Claude Code v4.0");
        assert_eq!(r1, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));

        // Simulate 10s elapsed
        det.set_last_transition(now_millis() - 10_000);
        let r2 = det.feed(b"\nuser@host$ ");
        assert_eq!(r2, Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() }));

        // Simulate 5s elapsed
        det.set_last_transition(now_millis() - 5000);
        let r3 = det.feed(b"Aider v0.50.0");
        assert_eq!(r3, Some(AgentDetectionEvent::Started { agent_name: "aider".to_string() }));
    }

    // ── PromptSeen / Waiting detection tests ─────────────────────────

    #[test]
    fn test_running_agent_prompt_transitions_to_prompt_seen() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        assert!(matches!(det.state, DetectionState::Running { .. }));

        // Feed claude's chevron prompt
        let r = det.feed(b"\xe2\x9d\xaf");
        assert_eq!(r, None); // No event emitted yet
        assert!(matches!(det.state, DetectionState::PromptSeen { .. }));
    }

    #[test]
    fn test_prompt_seen_non_prompt_output_returns_to_running() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        det.feed(b"\xe2\x9d\xaf"); // -> PromptSeen
        assert!(matches!(det.state, DetectionState::PromptSeen { .. }));

        // Feed non-prompt output (agent resumed work)
        let r = det.feed(b"some output from the agent\n");
        assert_eq!(r, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));
        assert!(matches!(det.state, DetectionState::Running { .. }));
    }

    #[test]
    fn test_prompt_seen_shell_prompt_transitions_to_idle() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        det.feed(b"\xe2\x9d\xaf"); // -> PromptSeen

        // Feed shell prompt
        let r = det.feed(b"\nuser@host$ ");
        assert_eq!(r, Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() }));
        assert_eq!(det.state, DetectionState::Idle);
    }

    #[test]
    fn test_prompt_seen_another_prompt_resets_seen_at() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        det.feed(b"\xe2\x9d\xaf"); // -> PromptSeen

        // Capture first seen_at
        let first_seen_at = match &det.state {
            DetectionState::PromptSeen { seen_at, .. } => *seen_at,
            _ => panic!("expected PromptSeen"),
        };

        // Small delay, then feed another prompt
        std::thread::sleep(std::time::Duration::from_millis(10));
        let r = det.feed(b"\xe2\x9d\xaf");
        assert_eq!(r, None);

        // seen_at should be updated
        let second_seen_at = match &det.state {
            DetectionState::PromptSeen { seen_at, .. } => *seen_at,
            _ => panic!("expected PromptSeen"),
        };
        assert!(second_seen_at >= first_seen_at);
    }

    #[test]
    fn test_check_waiting_returns_none_when_prompt_seen_age_under_2s() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        // Set PromptSeen with seen_at = now
        det.set_prompt_seen("claude", now_millis());

        assert_eq!(det.check_waiting(), None);
    }

    #[test]
    fn test_check_waiting_returns_waiting_when_prompt_seen_age_over_2s() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        // Set PromptSeen with seen_at = 3s ago
        det.set_prompt_seen("claude", now_millis() - 3000);

        assert_eq!(
            det.check_waiting(),
            Some(AgentDetectionEvent::Waiting { agent_name: "claude".to_string() })
        );
    }

    #[test]
    fn test_check_waiting_returns_none_when_running() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        assert!(matches!(det.state, DetectionState::Running { .. }));

        assert_eq!(det.check_waiting(), None);
    }

    #[test]
    fn test_check_waiting_returns_none_when_idle() {
        let det = OutputAgentDetector::with_cooldowns(0, 0);
        assert_eq!(det.state, DetectionState::Idle);

        assert_eq!(det.check_waiting(), None);
    }

    #[test]
    fn test_full_prompt_waiting_cycle() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);

        // Start agent
        let r1 = det.feed(b"Claude Code v4.0");
        assert_eq!(r1, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));

        // Agent shows prompt -> PromptSeen
        let r2 = det.feed(b"\xe2\x9d\xaf");
        assert_eq!(r2, None);
        assert!(matches!(det.state, DetectionState::PromptSeen { .. }));

        // Simulate 3s elapsed -> check_waiting returns Waiting
        det.set_prompt_seen("claude", now_millis() - 3000);
        assert_eq!(
            det.check_waiting(),
            Some(AgentDetectionEvent::Waiting { agent_name: "claude".to_string() })
        );

        // Agent resumes output -> back to Running
        let r3 = det.feed(b"doing some work...\n");
        assert_eq!(r3, Some(AgentDetectionEvent::Started { agent_name: "claude".to_string() }));
        assert!(matches!(det.state, DetectionState::Running { .. }));

        // Agent shows prompt again -> PromptSeen
        let r4 = det.feed(b"\xe2\x9d\xaf");
        assert_eq!(r4, None);

        // Simulate 3s elapsed -> check_waiting returns Waiting again
        det.set_prompt_seen("claude", now_millis() - 3000);
        assert_eq!(
            det.check_waiting(),
            Some(AgentDetectionEvent::Waiting { agent_name: "claude".to_string() })
        );

        // Shell prompt -> Idle
        let r5 = det.feed(b"\nuser@host$ ");
        assert_eq!(r5, Some(AgentDetectionEvent::Stopped { agent_name: "claude".to_string() }));
        assert_eq!(det.state, DetectionState::Idle);
    }

    #[test]
    fn test_aider_prompt_pattern() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Aider v0.50.0");
        assert!(matches!(det.state, DetectionState::Running { .. }));

        let r = det.feed(b"aider> ");
        assert_eq!(r, None); // No event, but state changed
        assert!(matches!(det.state, DetectionState::PromptSeen { .. }));
    }

    #[test]
    fn test_question_prompt_pattern() {
        let mut det = OutputAgentDetector::with_cooldowns(0, 0);
        det.feed(b"Claude Code v4.0");
        assert!(matches!(det.state, DetectionState::Running { .. }));

        let r = det.feed(b"? ");
        assert_eq!(r, None);
        assert!(matches!(det.state, DetectionState::PromptSeen { .. }));
    }
}
