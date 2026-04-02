---
phase: quick
plan: 260402-eef
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/src/agent_watcher.rs
  - src-tauri/src/pty.rs
autonomous: true
requirements: []
must_haves:
  truths:
    - "Agent prompt pattern (e.g. claude chevron, aider>) followed by 2s silence emits waiting status"
    - "Agent prompt followed by immediate output returns to running (no false waiting)"
    - "Shell prompt after waiting transitions to idle"
    - "Old 15s silence timer no longer drives waiting detection"
  artifacts:
    - path: "src-tauri/src/agent_watcher.rs"
      provides: "PromptSeen state, AGENT_PROMPT_PATTERNS, check_waiting(), Waiting event"
      contains: "PromptSeen"
    - path: "src-tauri/src/pty.rs"
      provides: "Waiting event handling in reader thread"
      contains: "AgentDetectionEvent::Waiting"
  key_links:
    - from: "src-tauri/src/agent_watcher.rs"
      to: "src-tauri/src/pty.rs"
      via: "AgentDetectionEvent::Waiting variant + check_waiting() method"
      pattern: "check_waiting|AgentDetectionEvent::Waiting"
---

<objective>
Replace the blunt 15s silence timer for "waiting" detection with prompt-pattern-based detection. When an agent shows its input prompt (e.g. claude's chevron, aider>) and 2s of silence follows, emit "waiting" status. If the agent resumes output after showing its prompt, return to "running" (false alarm suppressed).

Purpose: Faster, more accurate waiting detection -- 2s after prompt vs 15s blanket silence.
Output: Updated agent_watcher.rs with PromptSeen state machine + updated pty.rs wiring.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src-tauri/src/agent_watcher.rs
@src-tauri/src/pty.rs
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add PromptSeen state, prompt patterns, check_waiting(), and Waiting event to agent_watcher.rs</name>
  <files>src-tauri/src/agent_watcher.rs</files>
  <behavior>
    - Test: Running + agent prompt pattern -> state becomes PromptSeen
    - Test: PromptSeen + non-prompt output -> state returns to Running, emits Started (re-running)
    - Test: PromptSeen + shell prompt -> state becomes Idle, emits Stopped
    - Test: PromptSeen + another agent prompt -> resets seen_at timestamp
    - Test: check_waiting() returns None when PromptSeen age < 2000ms
    - Test: check_waiting() returns Waiting when PromptSeen age >= 2000ms
    - Test: check_waiting() returns None when state is Running or Idle
    - Test: Full cycle: start -> prompt -> wait -> resume -> prompt -> wait -> shell stop
  </behavior>
  <action>
    1. Add AGENT_PROMPT_PATTERNS constant — agent-specific input prompt byte patterns:
       - claude: [b"\xe2\x9d\xaf", b"? "] (the chevron prompt, question prompt)
       - aider: [b"aider> "]
       - codex: [b"codex> "]
       - gemini: [b"gemini> "]

    2. Add Waiting variant to AgentDetectionEvent:
       ```rust
       pub enum AgentDetectionEvent {
           Started { agent_name: String },
           Waiting { agent_name: String },
           Stopped { agent_name: String },
       }
       ```

    3. Add PromptSeen variant to DetectionState:
       ```rust
       enum DetectionState {
           Idle,
           Running { agent_name: String },
           PromptSeen { agent_name: String, seen_at: u64 },
       }
       ```

    4. Update feed() for Running state: after checking shell prompts, check AGENT_PROMPT_PATTERNS (only for the current agent). If matched, transition to PromptSeen { seen_at: now }. Clear ring. Return None (don't emit yet).

    5. Add feed() handling for PromptSeen state:
       - Shell prompt patterns -> Idle + emit Stopped (respect started_cooldown from original transition)
       - Agent prompt pattern (same agent) -> reset seen_at, clear ring, return None
       - Any other output (bytes fed but no prompt match) -> back to Running + emit Started { agent_name } to notify frontend of resumed activity. Clear ring.

    6. Add pub fn check_waiting(&mut self) -> Option<AgentDetectionEvent>:
       - If PromptSeen and (now - seen_at) > 2000ms, return Some(Waiting). Stay in PromptSeen state (don't transition).
       - Otherwise None.

    7. Rework start_silence_timer():
       - Remove was_waiting bool and 15s silence_threshold_ms logic entirely
       - Instead: lock the detector (from detectors HashMap), call check_waiting()
       - If returns Some(Waiting), emit agent-status-changed with "waiting" status
       - Add a `was_waiting` bool that tracks whether we already emitted Waiting for the current PromptSeen, so we don't spam events every 1s tick. Reset it when detector state changes away from PromptSeen.
       - Keep the 1s polling interval and cancellation logic as-is.
       - Change function signature to accept Arc<Mutex<OutputAgentDetector>> instead of last_output Arc.

    8. Update start_watching() to pass the detector Arc to start_silence_timer instead of last_output. The detector is available from AgentWatcherState.detectors.

    9. Update existing tests and add new tests per the behavior spec above. Use with_cooldowns(0, 0) for prompt/waiting tests to avoid cooldown interference. Use set_last_transition() where needed.
  </action>
  <verify>
    <automated>cd /Users/pierre/Workspace/perso/superagent && cargo test -p superagent --lib agent_watcher::tests 2>&1</automated>
  </verify>
  <done>PromptSeen state machine works: prompt pattern -> PromptSeen, 2s silence -> Waiting event, resumed output -> back to Running. Old 15s silence logic removed. All tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Wire Waiting event into pty.rs reader thread</name>
  <files>src-tauri/src/pty.rs</files>
  <action>
    1. In the reader thread's match on AgentDetectionEvent, add a branch for Waiting:
       ```rust
       AgentDetectionEvent::Waiting { ref agent_name } => {
           let _ = app_clone.emit(
               "agent-status-changed",
               AgentStatusPayload {
                   pty_id,
                   status: AgentStatus::Waiting.as_str().to_string(),
                   agent_name: agent_name.clone(),
                   pid: 0,
                   },
           );
       }
       ```
       Note: feed() won't return Waiting directly (check_waiting is called from the timer), but having the match arm prevents a compiler warning if the enum is exhaustive, and future-proofs if feed() ever returns Waiting.

    2. Verify the full build compiles cleanly with `cargo build -p superagent`.
  </action>
  <verify>
    <automated>cd /Users/pierre/Workspace/perso/superagent && cargo build -p superagent 2>&1 | tail -5</automated>
  </verify>
  <done>pty.rs handles all three AgentDetectionEvent variants. Full crate compiles without warnings.</done>
</task>

</tasks>

<verification>
- `cargo test -p superagent --lib` -- all unit tests pass (agent_watcher + pty)
- `cargo build -p superagent` -- clean build, no warnings
- Manual: start app, launch claude in terminal, observe "running" -> "waiting" transition within ~3s of claude showing its prompt (not 15s)
</verification>

<success_criteria>
- PromptSeen state machine detects agent prompts and emits Waiting after 2s silence
- False alarms suppressed: prompt followed by immediate output returns to Running
- 15s silence timer logic fully replaced by prompt-pattern + check_waiting approach
- All existing tests still pass, new tests cover PromptSeen transitions
</success_criteria>

<output>
After completion, create `.planning/quick/260402-eef-detect-agent-waiting-state-from-output-p/260402-eef-SUMMARY.md`
</output>
