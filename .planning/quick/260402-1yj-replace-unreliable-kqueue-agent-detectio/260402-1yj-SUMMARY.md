---
type: quick
subsystem: agent-detection
tags: [pty, pattern-matching, ring-buffer, agent-detection]

key-files:
  modified:
    - src-tauri/src/agent_watcher.rs
    - src-tauri/src/pty.rs

key-decisions:
  - "Clear ring buffer on state transitions to prevent stale pattern false matches"
  - "as_str made pub for cross-module access from pty.rs"

duration: 2min
completed: 2026-04-02
---

# Quick 260402-1yj: Replace unreliable kqueue agent detection with PTY output pattern matching

**OutputAgentDetector scans PTY bytes via ring buffer for agent signatures (Claude, aider, codex, gemini) and shell prompt returns, with 7 unit tests covering split patterns and full lifecycle**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-01T23:30:58Z
- **Completed:** 2026-04-01T23:32:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- OutputAgentDetector with 512-byte ring buffer handles patterns split across read() calls
- Agent detection via output patterns (claude, aider, codex, gemini) as primary method
- Shell prompt return detection ($ , % , # , newline-arrow) clears agent status
- Integration into PTY reader thread with zero additional threads
- kqueue watcher preserved as secondary detection signal
- Bug fix: ring buffer cleared on state transitions to prevent stale pattern re-matches
- 7 comprehensive unit tests covering all edge cases

## Task Commits

1. **Task 1: Create output pattern matcher and integrate into PTY reader thread** - `6f941a8` (feat)
2. **Task 2: Add unit tests for OutputAgentDetector** - `246fee2` (test)

## Files Created/Modified
- `src-tauri/src/agent_watcher.rs` - OutputAgentDetector struct, feed() method, AgentDetectionEvent enum, ring buffer clearing, 7 unit tests
- `src-tauri/src/pty.rs` - Reader thread integration calling detector.feed() and emitting agent-status-changed events

## Decisions Made
- Clear ring buffer on state transitions (Idle->Running, Running->Idle) to prevent stale bytes from causing false pattern matches in subsequent scans
- Made AgentStatus::as_str() public since pty.rs needs to call it for event emission

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ring buffer stale pattern false matches**
- **Found during:** Task 2 (unit testing)
- **Issue:** After agent stop, ring buffer still contained old agent signature bytes. Next feed() would re-detect the old agent instead of the new one.
- **Fix:** Added clear_ring() method called on every state transition to zero out the buffer and reset position.
- **Files modified:** src-tauri/src/agent_watcher.rs
- **Verification:** test_output_detector_full_cycle passes (start claude, stop, start aider, stop)
- **Committed in:** 246fee2 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correctness fix. Without it, multi-agent cycling would break.

## Issues Encountered
- AgentStatus::as_str() was private, blocking compilation of the PTY reader integration. Made pub in Task 1 commit.

## Known Stubs
None.

---
*Quick task: 260402-1yj*
*Completed: 2026-04-02*
