---
phase: quick
plan: 260402-dxs
type: execute
wave: 1
depends_on: []
files_modified: [src-tauri/src/agent_watcher.rs]
autonomous: true
requirements: [quick-fix]

must_haves:
  truths:
    - "Shell prompt patterns only match at line start, not mid-line in agent output"
    - "Agent startup patterns are specific enough to avoid false positives on casual mentions"
    - "State transitions are debounced to prevent rapid flipping"
    - "Ring buffer is large enough for reliable cross-chunk matching"
  artifacts:
    - path: "src-tauri/src/agent_watcher.rs"
      provides: "Improved OutputAgentDetector with specific patterns and debounce"
      contains: "last_transition_ms"
  key_links:
    - from: "OutputAgentDetector::feed"
      to: "SHELL_PROMPT_PATTERNS"
      via: "newline-prefixed byte matching"
      pattern: "b\"\\n"
---

<objective>
Fix flaky agent output detection in OutputAgentDetector. Shell prompt patterns are too generic (matching mid-line in agent output), agent startup patterns are too broad, and there is no debounce to prevent rapid state flipping.

Purpose: Eliminate false "stopped" events from prompt-like bytes in agent output and false "started" events from casual agent name mentions.
Output: Updated agent_watcher.rs with specific patterns, newline-anchored prompts, debounce logic, and comprehensive tests.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src-tauri/src/agent_watcher.rs
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix detection patterns and increase ring buffer</name>
  <files>src-tauri/src/agent_watcher.rs</files>
  <behavior>
    - Test: feeding `b"# This is a markdown header"` while Running does NOT trigger Stopped
    - Test: feeding `b"Run $ npm install to fix"` while Running does NOT trigger Stopped
    - Test: feeding `b"> quoted text from agent"` while Running does NOT trigger Stopped
    - Test: feeding `b"\nuser@host$ "` (newline + prompt) while Running DOES trigger Stopped
    - Test: feeding `b"\nuser@host% "` while Running DOES trigger Stopped
    - Test: feeding `b"Gemini"` alone while Idle does NOT trigger Started (too generic)
    - Test: feeding `b"Gemini Code Assist"` while Idle DOES trigger Started
    - Test: feeding standalone `b"\xe2\x80\xba"` while Idle does NOT trigger Started
    - Test: split pattern across chunks still works with 1024-byte buffer
  </behavior>
  <action>
Update AGENT_OUTPUT_PATTERNS to be more specific:
- claude: `[b"Claude Code", b"claude\xe2\x80\xba"]` — remove standalone `b"\xe2\x80\xba"` and `b"claude>"`
- aider: `[b"Aider v", b"aider>"]` — keep as-is, these are specific enough
- codex: `[b"codex>", b"OpenAI Codex"]` — replace `b"Codex v"` with full product name
- gemini: `[b"Gemini Code", b"gemini>"]` — replace bare `b"Gemini"` with product name prefix

Update SHELL_PROMPT_PATTERNS to require newline prefix:
- `b"\n$ "`, `b"\n% "`, `b"\n# "`, `b"\n\xe2\x9d\xaf "` (newline + zsh starship)
- REMOVE the bare `> ` pattern entirely (too ambiguous even with newline — agents print `\n> ` in quoted blocks)

Increase ring buffer capacity from 512 to 1024 bytes in `OutputAgentDetector::new()`.

Update ALL existing tests that rely on old patterns:
- `test_output_detector_detects_shell_return`: prompt bytes must include preceding `\n`
- `test_output_detector_full_cycle`: same fix for prompt patterns
- Any test feeding bare `$ ` or `% ` needs `\n` prefix

Write NEW tests for false positive resistance per the behavior block above.
  </action>
  <verify>
    <automated>cd /Users/pierre/Workspace/perso/superagent/src-tauri && cargo test --lib agent_watcher -- --nocapture 2>&1</automated>
  </verify>
  <done>All agent patterns are specific to actual product names/prompts. Shell prompts only match at line boundaries. No mid-line false positives. Ring buffer is 1024 bytes. All tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add debounce to prevent rapid state flipping</name>
  <files>src-tauri/src/agent_watcher.rs</files>
  <behavior>
    - Test: after Started event, feeding shell prompt bytes within 3 seconds returns None (debounced)
    - Test: after Started event, feeding shell prompt bytes after 3+ seconds returns Stopped
    - Test: after Stopped event, feeding agent pattern within 1 second returns None (debounced)
    - Test: after Stopped event, feeding agent pattern after 1+ seconds returns Started
    - Test: normal operation with no rapid transitions works unchanged
  </behavior>
  <action>
Add timestamp-based debounce to OutputAgentDetector:

1. Add fields to OutputAgentDetector struct:
   - `last_transition_ms: u64` — timestamp of last state change (use `now_millis()`)
   - `started_cooldown_ms: u64` — 3000 (after Started, ignore Stopped for 3s)
   - `stopped_cooldown_ms: u64` — 1000 (after Stopped, ignore Started for 1s)

2. In `feed()`, after pattern match but BEFORE state transition:
   - Calculate `elapsed = now_millis() - self.last_transition_ms`
   - If in Running state and matched a shell prompt: skip if `elapsed < started_cooldown_ms`
   - If in Idle state and matched an agent pattern: skip if `elapsed < stopped_cooldown_ms`

3. On successful state transition, update `last_transition_ms = now_millis()`

4. Add `#[cfg(test)]` helper `fn set_last_transition(&mut self, ms: u64)` to allow tests to fake timestamps without sleeping.

5. Also add `fn with_cooldowns(started_ms: u64, stopped_ms: u64) -> Self` constructor for test control.

Write tests per behavior block. Tests use `set_last_transition` to set timestamp in the past to simulate elapsed time, avoiding actual sleeps.
  </action>
  <verify>
    <automated>cd /Users/pierre/Workspace/perso/superagent/src-tauri && cargo test --lib agent_watcher -- --nocapture 2>&1</automated>
  </verify>
  <done>Debounce prevents state flipping within cooldown windows. 3s cooldown after Started, 1s cooldown after Stopped. All tests pass including debounce behavior tests.</done>
</task>

</tasks>

<verification>
cd /Users/pierre/Workspace/perso/superagent/src-tauri && cargo test --lib agent_watcher -- --nocapture
cd /Users/pierre/Workspace/perso/superagent/src-tauri && cargo build 2>&1 | tail -5
</verification>

<success_criteria>
- Zero false "Stopped" events from mid-line `$ `, `% `, `# `, `> ` in agent output
- Zero false "Started" events from bare "Gemini" or standalone Unicode chars
- Rapid state transitions are suppressed by debounce (3s post-start, 1s post-stop)
- All existing and new tests pass
- Cargo build succeeds with no warnings in agent_watcher.rs
</success_criteria>

<output>
After completion, create `.planning/quick/260402-dxs-fix-flaky-agent-output-detection-better-/260402-dxs-SUMMARY.md`
</output>
