---
phase: 02-split-panes-keyboard
plan: 01
subsystem: ui
tags: [zustand, immer, tdd, pane-tree, keyboard-shortcuts, pty]

# Dependency graph
requires:
  - phase: 01-app-shell-single-terminal
    provides: PTY manager, terminal store, pty.ts IPC wrappers
provides:
  - Pure pane tree operations (split, remove, navigate, updateRatio)
  - Zustand pane tree store with immer
  - Keyboard registry hook (capture-phase interception)
  - close_pty backend command + frontend wrapper
affects: [02-split-panes-keyboard plan 02, 02-split-panes-keyboard plan 03]

# Tech tracking
tech-stack:
  added: [immer]
  patterns: [pure-function-with-zustand-store, tdd-red-green, capture-phase-keyboard-interception]

key-files:
  created:
    - src/lib/pane-tree-ops.ts
    - src/lib/__tests__/pane-tree-ops.test.ts
    - src/hooks/useKeyboardRegistry.ts
    - src/hooks/__tests__/useKeyboardRegistry.test.ts
    - src/stores/pane-tree.ts
  modified:
    - src-tauri/src/pty.rs
    - src-tauri/src/lib.rs
    - src/lib/pty.ts

key-decisions:
  - "splitNode returns [PaneNode, PaneId] tuple for unambiguous focus tracking"
  - "closePane creates sentinel leaf (ptyId=-1) instead of null root"
  - "Keyboard registry uses capture phase to intercept before xterm.js"
  - "navigate uses findFirstLeaf for entering adjacent subtrees"

patterns-established:
  - "Pure functions + Zustand store: tree ops in pane-tree-ops.ts, store delegates via import"
  - "TDD for pure logic: write failing tests first, then implement"
  - "Sentinel pane pattern: ptyId=-1 signals need for PTY spawn"

requirements-completed: [TERM-02, TERM-03, TERM-05, TERM-06, KEYS-01, KEYS-02, KEYS-03]

# Metrics
duration: 4min
completed: 2026-04-01
---

# Phase 02 Plan 01: Pane Tree Data Layer Summary

**Pure pane tree operations with TDD (split/remove/navigate/ratio), Zustand store with immer, capture-phase keyboard registry, and close_pty backend command**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T07:55:31Z
- **Completed:** 2026-04-01T07:59:41Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Pane tree pure functions fully tested (17 cases): splitNode, removeNode, findLeaf, findFirstLeaf, navigate, updateRatio
- Keyboard registry hook with capture-phase interception tested (6 cases)
- Zustand pane tree store with immer middleware wiring all pure functions
- close_pty Tauri command killing child process and cleaning up PTY resources

## Task Commits

Each task was committed atomically:

1. **Task 1: Pane tree pure functions with tests (TDD)** - `4f824e2` (feat)
2. **Task 2: Keyboard registry hook + Zustand pane tree store** - `d9a2311` (feat)
3. **Task 3: close_pty backend command + frontend wrapper** - `2569b23` (feat)

## Files Created/Modified
- `src/lib/pane-tree-ops.ts` - Pure functions: splitNode, removeNode, findLeaf, findFirstLeaf, navigate, updateRatio
- `src/lib/__tests__/pane-tree-ops.test.ts` - 17 test cases for all pane tree operations
- `src/hooks/useKeyboardRegistry.ts` - Capture-phase keydown interception hook
- `src/hooks/__tests__/useKeyboardRegistry.test.ts` - 6 test cases for keyboard matching
- `src/stores/pane-tree.ts` - Zustand store with immer: splitPane, closePane, setFocus, navigate, updateRatio, setPtyId
- `src-tauri/src/pty.rs` - Added close_pty command + test
- `src-tauri/src/lib.rs` - Registered close_pty in invoke_handler
- `src/lib/pty.ts` - Added closePty frontend wrapper

## Decisions Made
- splitNode returns [PaneNode, PaneId] tuple so callers can unambiguously set focusedPaneId to the new leaf
- closePane creates sentinel leaf with ptyId=-1 instead of setting root to null, keeping root always non-null
- navigate uses findFirstLeaf when entering adjacent subtrees (consistent DFS-first behavior)
- Keyboard registry listens on capture phase to intercept shortcuts before xterm.js receives them

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None - all functions fully implemented and tested.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All pure logic and state management ready for Plan 02 (UI components)
- usePaneTreeStore provides all actions the React split pane UI needs
- useKeyboardRegistry ready for wiring to pane split/close/navigate shortcuts
- closePty available for pane close operations

---
*Phase: 02-split-panes-keyboard*
*Completed: 2026-04-01*

## Self-Check: PASSED

All 8 files found. All 3 commits verified.
