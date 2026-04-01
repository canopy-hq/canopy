---
phase: 05-agent-detection-status-ui
plan: 02
subsystem: ui
tags: [react, zustand, agent-status, xterm, tailwind]

requires:
  - phase: 05-01
    provides: "AgentStore, StatusDot, agent CSS tokens, selectAgentForPty/selectRunningCount/selectWaitingCount selectors"
provides:
  - "PaneHeader agent dot + name display"
  - "TerminalPane amber glow on waiting state (AGNT-10)"
  - "TabBar status dot, amber tint, input badge (TABS-04, TABS-05)"
  - "WorkspaceTree branch/worktree agent dots (SIDE-03)"
  - "WorkspaceTree collapsed repo summary dots (SIDE-04)"
  - "StatusBar live agent count summary"
affects: [05-03, 05-04]

tech-stack:
  added: []
  patterns:
    - "useTabAgentStatus hook: aggregate agent status across all leaf ptyIds in a tab's pane tree"
    - "useWorkspaceAgentMap hook: cross-reference tabs and agent store by workspaceItemId"
    - "useRepoAgentSummary hook: collect per-repo agent statuses sorted waiting-first"
    - "RepoTreeItem extracted as separate component for per-repo hook usage"

key-files:
  created:
    - "src/components/__tests__/TerminalPane.test.tsx"
    - "src/components/__tests__/TabBar.test.tsx"
  modified:
    - "src/components/PaneHeader.tsx"
    - "src/components/TerminalPane.tsx"
    - "src/components/StatusBar.tsx"
    - "src/components/TabBar.tsx"
    - "src/components/WorkspaceTree.tsx"
    - "src/components/__tests__/WorkspaceTree.test.tsx"

key-decisions:
  - "Extracted RepoTreeItem as separate component to allow per-repo useRepoAgentSummary hook call"
  - "Agent status aggregation: waiting takes priority over running in multi-pane tabs"

patterns-established:
  - "collectLeafPtyIds: recursive helper to extract ptyIds from pane tree (used in TabBar and WorkspaceTree)"
  - "Cross-store agent mapping pattern: combine tabs store (workspaceItemId) with agent store (ptyId) for sidebar rendering"

requirements-completed: [AGNT-10, TABS-04, TABS-05, SIDE-03, SIDE-04]

duration: 5min
completed: 2026-04-02
---

# Phase 05 Plan 02: UI Agent Status Indicators Summary

**Agent status wired into all 5 UI surfaces: pane header dot+name, terminal amber glow, tab dot+badge, sidebar dots+summary, status bar counts**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T22:59:33Z
- **Completed:** 2026-04-01T23:04:57Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- PaneHeader shows StatusDot + agent name before CWD text when agent running/waiting
- TerminalPane renders amber border glow (border + box-shadow) when agent is in waiting state per AGNT-10
- TabBar shows green pulsing dot (running), amber breathing dot + amber tint + "input" pill badge (waiting) per TABS-04/TABS-05
- WorkspaceTree branch/worktree rows show agent status dots (SIDE-03), collapsed repos show up to 3 summary dots with +N overflow (SIDE-04)
- StatusBar shows "N working" (green) / "N waiting" (amber) before shortcut hints
- 10 new agent-related test cases across 3 test files, all 156 project tests pass

## Task Commits

1. **Task 1: PaneHeader, TerminalPane, StatusBar agent integration** - `3c7a4b3` (feat)
2. **Task 2: TabBar and WorkspaceTree agent status indicators** - `ea070e5` (feat)

## Files Created/Modified
- `src/components/PaneHeader.tsx` - Added agentStatus/agentName props, StatusDot + name rendering
- `src/components/TerminalPane.tsx` - Amber border glow + inset shadow when agent waiting, passes status to PaneHeader
- `src/components/StatusBar.tsx` - Live agent count summary (running/waiting) from agent store selectors
- `src/components/TabBar.tsx` - StatusDot, amber tint, "input" badge; collectLeafPtyIds + useTabAgentStatus helpers
- `src/components/WorkspaceTree.tsx` - Agent dots on items, summary dots on collapsed repos; useWorkspaceAgentMap + useRepoAgentSummary hooks
- `src/components/__tests__/TerminalPane.test.tsx` - 4 tests for amber glow (waiting/running/no-agent/header passthrough)
- `src/components/__tests__/TabBar.test.tsx` - 3 tests for tab status dot, amber tint, idle state
- `src/components/__tests__/WorkspaceTree.test.tsx` - 3 new agent tests (branch dot, summary dots, +N overflow)

## Decisions Made
- Extracted RepoTreeItem as a separate component so useRepoAgentSummary hook can be called per-workspace (hooks must be at component top level)
- Agent status aggregation in tabs: waiting status takes priority over running when multiple panes have agents

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- ResizeObserver not available in jsdom test environment for TabBar tests -- added MockResizeObserver class in test setup

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 5 UI surfaces now agent-aware, ready for Plan 03 (Agent Overlay) and Plan 04 (Toast notifications)
- Agent store selectors proven working across PaneHeader, TerminalPane, TabBar, WorkspaceTree, StatusBar

---
*Phase: 05-agent-detection-status-ui*
*Completed: 2026-04-02*
