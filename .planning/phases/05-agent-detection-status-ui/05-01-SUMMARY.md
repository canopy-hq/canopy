---
phase: 05-agent-detection-status-ui
plan: 01
subsystem: agent-detection
tags: [kqueue, libproc, zustand, tauri-events, css-animations]

# Dependency graph
requires:
  - phase: 01-app-shell-single-terminal
    provides: PTY manager, reader thread, spawn_terminal
  - phase: 03-tabs-themes-statusbar
    provides: CSS custom properties, theme system, :root token pattern
provides:
  - Rust kqueue-based agent process watcher (agent_watcher.rs)
  - PTY output timestamp tracking (AtomicU64 in reader thread)
  - Silence-based waiting detection (15s threshold, tokio timer)
  - Frontend Zustand agent store keyed by ptyId
  - StatusDot reusable component with pulse/breathe animations
  - Agent CSS custom properties (--agent-running, --agent-waiting, glow/border/inset)
affects: [05-02, 05-03, 05-04]

# Tech tracking
tech-stack:
  added: [kqueue 1.1, libproc 0.14]
  patterns: [kqueue EVFILT_PROC watcher thread, AtomicU64 output tracking, poll_forever loop for mutable watcher access]

key-files:
  created:
    - src-tauri/src/agent_watcher.rs
    - src/stores/agent-store.ts
    - src/stores/__tests__/agent-store.test.ts
    - src/components/StatusDot.tsx
    - src/components/__tests__/StatusDot.test.tsx
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/src/pty.rs
    - src-tauri/src/lib.rs
    - src/index.css

key-decisions:
  - "Used poll_forever(None) instead of iter() for kqueue watcher to allow mutable watcher access for dynamic child PID registration"
  - "Used NOTE_TRACK flag for automatic child process tracking via kqueue kernel support"
  - "Agent CSS tokens defined once in :root only (same pattern as git tokens), not per-theme"

patterns-established:
  - "Kqueue watcher thread pattern: std::thread + poll_forever loop + oneshot cancel channel"
  - "Agent store: separate Zustand store keyed by ptyId, stable selectors with no filter/map"
  - "Tauri event listener: lazy import pattern with initAgentListener/cleanupAgentListener"

requirements-completed: [AGNT-01, AGNT-02, AGNT-03, AGNT-04]

# Metrics
duration: 7min
completed: 2026-04-02
---

# Phase 05 Plan 01: Agent Detection Backend + Store + StatusDot Summary

**Kqueue-based agent detection on PTY child processes with silence-based waiting heuristic, Zustand agent store, and animated StatusDot component**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-01T22:50:42Z
- **Completed:** 2026-04-01T22:57:20Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Rust kqueue watcher detects agent processes (claude, codex, aider, gemini) in PTY child tree via EVFILT_PROC events
- PTY reader thread tracks last output timestamp atomically; silence >15s triggers "waiting" transition via tokio timer
- Frontend Zustand agent store receives status events via Tauri event system with stable selectors
- StatusDot renders animated colored dots (green pulse for running, amber breathe for waiting, hidden for idle)
- Agent CSS tokens available globally in :root for all 8 themes

## Task Commits

Each task was committed atomically:

1. **Task 1: Rust agent detection backend + pty.rs integration** - `d464e1f` (feat)
2. **Task 2: Frontend agent store + StatusDot component + CSS tokens** - `eb8e642` (feat)

## Files Created/Modified
- `src-tauri/src/agent_watcher.rs` - Kqueue watcher, known_agents matching, silence timer, Tauri commands
- `src-tauri/src/pty.rs` - AtomicU64 output tracking, child PID extraction, auto-start agent watcher
- `src-tauri/src/lib.rs` - Register agent_watcher module and commands
- `src-tauri/Cargo.toml` - Added kqueue 1.1 and libproc 0.14 dependencies
- `src/stores/agent-store.ts` - Zustand+immer store with event listener, stable selectors
- `src/stores/__tests__/agent-store.test.ts` - 9 tests for store CRUD and selectors
- `src/components/StatusDot.tsx` - Reusable status dot with CSS variable colors and animations
- `src/components/__tests__/StatusDot.test.tsx` - 6 tests for rendering, animation, accessibility
- `src/index.css` - Agent CSS tokens in :root + pulse-slow/breathe keyframes

## Decisions Made
- Used `poll_forever(None)` instead of `iter()` for kqueue watcher loop because Rust borrow checker prevents mutable access to watcher during its own iterator (needed for adding child PID watchers dynamically)
- Used `NOTE_TRACK` kqueue flag for automatic child process tracking -- kernel delivers `Proc::Track(child_pid)` events when watched process forks
- Agent CSS tokens placed in `:root` only (not per-theme), matching the established pattern for semantic colors like git ahead/behind

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Kqueue crate API mismatch -- EventData::Proc is enum, not bitflags**
- **Found during:** Task 1 (agent_watcher.rs compilation)
- **Issue:** Research suggested `flags.contains(FilterFlag::NOTE_FORK)` pattern but kqueue crate uses `Proc::Fork` enum variants, not bitflags
- **Fix:** Rewrote event handling to match on `Proc::Fork`, `Proc::Exec`, `Proc::Exit(_)`, `Proc::Track(pid)`, `Proc::Child(pid)` enum variants
- **Files modified:** src-tauri/src/agent_watcher.rs
- **Verification:** cargo test + cargo build pass
- **Committed in:** d464e1f

**2. [Rule 3 - Blocking] Borrow checker prevents mutable watcher access during iter()**
- **Found during:** Task 1 (agent_watcher.rs compilation)
- **Issue:** `for event in watcher.iter()` borrows watcher immutably, preventing `watcher.add_pid()` calls inside the loop for child PID registration
- **Fix:** Replaced `iter()` with `poll_forever(None)` loop pattern, collecting child PIDs in a local variable and adding them after event processing
- **Files modified:** src-tauri/src/agent_watcher.rs
- **Verification:** cargo test + cargo build pass
- **Committed in:** d464e1f

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary to work with the actual kqueue crate API. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all data paths are wired end-to-end (Rust watcher -> Tauri event -> Zustand store -> StatusDot).

## Next Phase Readiness
- Agent detection pipeline complete and tested
- StatusDot component ready for integration into PaneHeader, TabBar, Sidebar (Plan 05-02)
- Agent store selectors ready for status bar summary and overlay (Plans 05-03, 05-04)

---
*Phase: 05-agent-detection-status-ui*
*Completed: 2026-04-02*
