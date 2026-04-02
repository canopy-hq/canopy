---
phase: quick
plan: 260402-dxs
subsystem: agent-detection
tags: [bugfix, output-detection, debounce]
dependency_graph:
  requires: []
  provides: [reliable-output-agent-detection]
  affects: [pty-reader-thread]
tech_stack:
  added: []
  patterns: [newline-anchored-byte-matching, timestamp-debounce]
key_files:
  created: []
  modified: [src-tauri/src/agent_watcher.rs]
decisions:
  - "Newline-anchored matching via contains_bytes_after_newline instead of embedding \\n in patterns"
  - "3s cooldown after Started, 1s after Stopped chosen to match typical agent startup/exit timing"
metrics:
  duration: 4min
  completed: 2026-04-02
---

# Quick Task 260402-dxs: Fix Flaky Agent Output Detection Summary

Hardened OutputAgentDetector with specific agent product-name patterns, newline-anchored shell prompt matching, 1024-byte ring buffer, and timestamp-based debounce (3s post-start, 1s post-stop).

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Fix detection patterns and increase ring buffer | e978ad4 | Specific agent patterns (Claude Code, Aider v, OpenAI Codex, Gemini Code), newline-anchored prompts via contains_bytes_after_newline, 1024-byte ring buffer, 9 new false-positive tests |
| 2 | Add debounce to prevent rapid state flipping | 9b6a569 | last_transition_ms field, 3s started cooldown, 1s stopped cooldown, with_cooldowns/set_last_transition test helpers, 5 debounce tests |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Shell prompt newline anchoring approach changed**
- **Found during:** Task 1
- **Issue:** Plan specified embedding `\n` directly in SHELL_PROMPT_PATTERNS (e.g., `b"\n$ "`), but this doesn't match real prompts like `\nuser@host$ ` where text appears between newline and prompt char.
- **Fix:** Created `contains_bytes_after_newline()` function that checks if the pattern appears anywhere after a newline in the window. Patterns remain as bare `b"$ "` etc., but matching is newline-gated.
- **Files modified:** src-tauri/src/agent_watcher.rs
- **Commit:** e978ad4

**2. [Rule 1 - Bug] `with_cooldowns` gated with `#[cfg(test)]`**
- **Found during:** Task 2
- **Issue:** Cargo build warned about dead code for `with_cooldowns()` since it's only used in tests.
- **Fix:** Added `#[cfg(test)]` attribute.
- **Files modified:** src-tauri/src/agent_watcher.rs
- **Commit:** 9b6a569

## Verification Results

- `cargo test --lib agent_watcher`: 28 passed, 0 failed
- `cargo build`: clean, no warnings

## Known Stubs

None.

## Self-Check: PASSED
