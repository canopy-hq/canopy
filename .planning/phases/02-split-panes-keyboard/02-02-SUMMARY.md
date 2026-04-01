---
phase: 02-split-panes-keyboard
plan: 02
subsystem: ui
tags: [react, xterm, split-pane, flexbox, zustand, pointer-capture]

requires:
  - phase: 02-split-panes-keyboard/01
    provides: "Pane tree store (usePaneTreeStore), tree operations (splitNode, removeNode, navigate, updateRatio), keyboard registry"
provides:
  - "PaneContainer recursive pane tree renderer"
  - "SplitContainer flexbox layout with ratio-based sizing"
  - "Splitter draggable divider with pointer capture"
  - "TerminalPane with sentinel PTY spawn, focus indicator, CWD header"
  - "PaneHeader floating CWD overlay"
  - "useSplitterDrag pointer capture drag hook"
  - "Refactored useTerminal accepting ptyId, isFocused, onCwdChange"
affects: [02-split-panes-keyboard/03, keyboard-shortcuts, session-persistence]

tech-stack:
  added: []
  patterns: ["Recursive PaneNode renderer (leaf->TerminalPane, branch->SplitContainer)", "Sentinel ptyId=-1 triggers PTY spawn on mount", "Pointer capture for drag operations", "OSC 7 CWD detection in terminal"]

key-files:
  created:
    - src/components/PaneContainer.tsx
    - src/components/SplitContainer.tsx
    - src/components/Splitter.tsx
    - src/components/TerminalPane.tsx
    - src/components/PaneHeader.tsx
    - src/hooks/useSplitterDrag.ts
    - src/components/__tests__/PaneHeader.test.tsx
  modified:
    - src/hooks/useTerminal.ts
    - src/components/Terminal.tsx

key-decisions:
  - "TerminalPane uses inner component pattern to keep hooks unconditional (no hooks after early return)"
  - "spawnTerminal callback is no-op since Tauri Channel handles PTY output routing"
  - "Splitter tracks hover/dragging state locally (not in store) to avoid store churn"

patterns-established:
  - "Recursive renderer: PaneContainer reads root, PaneNodeRenderer dispatches leaf vs branch"
  - "Sentinel spawn: ptyId=-1 triggers useEffect to spawn PTY, then setPtyId updates tree"
  - "Pointer capture drag: setPointerCapture + document-level move/up listeners in useSplitterDrag"

requirements-completed: [TERM-02, TERM-03, TERM-04]

duration: 4min
completed: 2026-04-01
---

# Phase 02 Plan 02: Split Pane Components Summary

**Recursive split pane renderer with flexbox layout, draggable splitters via pointer capture, and terminal panes with sentinel PTY spawn and floating CWD headers**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T08:02:17Z
- **Completed:** 2026-04-01T08:06:09Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Refactored useTerminal for multi-pane: accepts ptyId/isFocused, has debounced resize, OSC 7 CWD detection, and xterm key passthrough for app shortcuts
- Built 5 new components (PaneContainer, SplitContainer, Splitter, TerminalPane, PaneHeader) wired to pane tree store
- Created useSplitterDrag hook with pointer capture and document-level move/up listeners
- TerminalPane handles ptyId=-1 sentinel by spawning PTY on mount and updating tree store
- Updated Terminal.tsx to delegate to PaneContainer (seamless migration from single-pane)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor useTerminal + create useSplitterDrag + PaneHeader with tests** - `c202c17` (feat)
2. **Task 2: PaneContainer, SplitContainer, Splitter, TerminalPane components** - `ae51029` (feat)

## Files Created/Modified
- `src/components/PaneContainer.tsx` - Recursive pane tree renderer (root -> PaneNodeRenderer)
- `src/components/SplitContainer.tsx` - Flexbox layout with ratio-based sizing and splitters between children
- `src/components/Splitter.tsx` - 6px hit area / 2px visible line divider with idle/hover/active states
- `src/components/TerminalPane.tsx` - Terminal wrapper with sentinel spawn, focus border, PaneHeader overlay
- `src/components/PaneHeader.tsx` - Floating CWD overlay (last 2 path segments, backdrop blur)
- `src/hooks/useTerminal.ts` - Refactored: accepts ptyId, isFocused, onCwdChange; debounced resize; OSC 7; key passthrough
- `src/hooks/useSplitterDrag.ts` - Pointer capture drag hook for splitter ratio updates
- `src/components/__tests__/PaneHeader.test.tsx` - 6 tests for CWD display and focus styling
- `src/components/Terminal.tsx` - Updated to delegate to PaneContainer

## Decisions Made
- TerminalPane uses inner component pattern (TerminalPaneInner) to keep React hooks unconditional -- hooks cannot appear after early return for the sentinel loading state
- spawnTerminal callback is a no-op because Tauri Channel-based approach already routes PTY output; xterm binding happens via the same channel after useTerminal mounts
- Splitter tracks hover/dragging state locally with useState (not in Zustand store) to avoid unnecessary store updates during drag interactions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unused useCallback import in useTerminal.ts**
- **Found during:** Task 2 (TypeScript compilation check)
- **Issue:** useCallback was imported but not used after refactor
- **Fix:** Removed unused import
- **Files modified:** src/hooks/useTerminal.ts
- **Committed in:** ae51029 (Task 2 commit)

**2. [Rule 3 - Blocking] Updated Terminal.tsx to use PaneContainer**
- **Found during:** Task 2 (TypeScript compilation check)
- **Issue:** Terminal.tsx still called old useTerminal(containerRef) with 1 arg, new signature requires 3-4
- **Fix:** Replaced TerminalView body with PaneContainer delegation
- **Files modified:** src/components/Terminal.tsx
- **Committed in:** ae51029 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for TypeScript compilation. No scope creep.

## Known Pre-existing Issues

- `src/lib/pane-tree-ops.ts` has 19 TypeScript strict-mode errors (array index access, union narrowing) from Plan 01. These are out of scope for this plan and do not affect runtime behavior (all tests pass).

## Issues Encountered
None beyond the deviations noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All split pane components built and wired to pane tree store
- Ready for Plan 03 (keyboard shortcuts wiring) to connect Cmd+D/Shift+D/W/Arrow to store actions
- The keyboard registry from Plan 01 + attachCustomKeyEventHandler from this plan provide the interception layer

---
*Phase: 02-split-panes-keyboard*
*Completed: 2026-04-01*
