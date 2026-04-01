---
type: quick
quick_id: 260401-wj7
description: "Refactor tabs to be context-scoped per workspace item"
completed: "2026-04-01T21:30:00Z"
duration: "3min"
tasks_completed: 2
tasks_total: 2
key_files:
  modified:
    - src/stores/tabs-store.ts
    - src/stores/__tests__/tabs-store.test.ts
    - src/components/TabBar.tsx
    - src/stores/workspace-store.ts
    - src/stores/__tests__/workspace-store.test.ts
    - src/App.tsx
decisions:
  - "getContextTabs is a plain getter (not immer), same pattern as getActiveTab"
  - "workspaceItemId changed from optional to required string (default: 'default')"
  - "closeTab spawns fresh tab scoped to the closed tab's context, not just globally"
---

# Quick Task 260401-wj7: Refactor Tabs to Context-Scoped per Workspace Item

Context-scoped tab groups via activeContextId + contextActiveTabIds map, with TabBar filtering and workspace-store integration.

## What Changed

### tabs-store.ts
- Added `activeContextId: string` (default: "default") and `contextActiveTabIds: Record<string, string>` to track per-context active tab
- Added `setActiveContext(contextId, label?)` -- saves current tab, switches context, creates/restores tab group
- Added `getContextTabs()` -- plain getter returning tabs filtered by activeContextId
- `addTab()` now assigns `workspaceItemId: activeContextId` to new tabs
- `closeTab()` checks last-tab-in-context (not global), spawns fresh tab with same workspaceItemId
- `switchTabByIndex()` and `switchTabRelative()` now operate on context-filtered tabs
- Removed `findOrCreateTabForWorkspaceItem` (replaced by `setActiveContext`)
- `workspaceItemId` changed from `string | undefined` to `string` (always set)

### TabBar.tsx
- Changed selector from `s.tabs` to `s.getContextTabs()` -- shows only active context's tabs

### workspace-store.ts
- `selectWorkspaceItem(id, label)` calls `setActiveContext(id, label)` instead of `findOrCreateTabForWorkspaceItem`
- `selectWorkspaceItem(null)` calls `setActiveContext('default')` to return to default context

### App.tsx
- Simplified rendering: uses `getActiveTab()` instead of mapping all tabs with visibility check

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6af6222 | Add context-scoped tab management to tabs-store |
| 2 | a7e6571 | Wire TabBar, workspace-store, and App to context-scoped tabs |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None.

## Verification

- All 124 tests pass (31 tabs-store, rest unchanged)
- grep checks confirm activeContextId, setActiveContext, getContextTabs in tabs-store and workspace-store
