---
status: diagnosed
phase: 04-git-integration-sidebar
source: [04-VERIFICATION.md]
started: 2026-04-01T21:23:00Z
updated: 2026-04-01T21:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Sidebar resize drag behavior
expected: Sidebar width changes smoothly on drag; stops at 180px min / 400px max; no layout breaks
result: [pending]

### 2. Import Repository native dialog
expected: Native macOS folder picker opens, selected path imports repo, sidebar shows workspace tree
result: [pending]

### 3. Branch/worktree create flow end-to-end
expected: Modal opens from "+ New Branch", type cards switch, git preview updates, create triggers real git op, tree refreshes
result: [pending]

### 4. Non-obsidian theme colors for git tokens
expected: Branch icons blue (#60a5fa), worktree icons purple (#c084fc), ahead green (#4ade80), behind red (#f87171) across all themes
result: [pending]

## Summary

total: 4
passed: 0
issues: 2
pending: 4
skipped: 0
blocked: 0

## Gaps

### GAP-1: Workspace-terminal association missing
status: failed
severity: high
description: Selecting a branch/worktree in the sidebar does not switch terminal panes. Each workspace (branch/worktree) should have its own set of terminal panes. Switching workspace swaps the entire right panel (pane layout + terminal sessions). Returning to a previous workspace restores its terminals. New workspace opens with one default terminal (or empty + Cmd+T).
impact: Core UX broken — sidebar selection is decorative without terminal switching. Prerequisite for Phase 5 agent-per-workspace features.
fix: Rearchitect pane store to key layouts per workspace ID. Wire sidebar workspace selection to swap active pane set. Persist per-workspace pane state. Open default terminal on first workspace switch.

### GAP-2: Sidebar tree items use text cursor instead of pointer
status: failed
severity: low
description: Hovering over branch/worktree items in the sidebar tree shows the text selection cursor (I-beam) instead of the pointer/hand cursor.
fix: Add `cursor: pointer` to clickable tree items in WorkspaceTree.tsx.
