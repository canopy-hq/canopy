---
phase: 03-tabs-themes-statusbar
plan: 01
subsystem: ui
tags: [themes, css-custom-properties, tailwind-v4, zustand, tabs, xterm]

requires:
  - phase: 02-split-panes-keyboard
    provides: pane-tree-ops pure functions, PaneNode types, keyboard registry
provides:
  - 8 dark theme definitions with CSS + xterm color schemes
  - CSS custom properties for all themes with Tailwind @theme registration
  - Tabs Zustand store with per-tab pane trees
  - terminal-cache getAllCached export
affects: [03-02, 03-03, settings, session-persistence]

tech-stack:
  added: []
  patterns: [data-theme CSS switching, per-tab pane tree isolation, Tailwind @theme for CSS variable colors]

key-files:
  created:
    - src/lib/themes.ts
    - src/lib/__tests__/themes.test.ts
    - src/stores/tabs-store.ts
    - src/stores/__tests__/tabs-store.test.ts
  modified:
    - src/index.css
    - src/lib/terminal-cache.ts
    - src/stores/pane-tree.ts
    - src/components/PaneContainer.tsx
    - src/components/TerminalPane.tsx
    - src/App.tsx

key-decisions:
  - "Obsidian theme as default -- exact match of previous hardcoded colors for zero visual regression"
  - "pane-tree.ts reduced to re-export shim for backward compatibility during migration"
  - "PaneContainer accepts root prop instead of reading store -- enables per-tab rendering"

patterns-established:
  - "Theme switching via data-theme attribute on html element"
  - "Tailwind color utilities via @theme block referencing CSS variables (bg-bg-primary, text-text-primary)"
  - "Tab store owns pane trees -- all pane operations scoped to active tab"

requirements-completed: [TABS-01, TABS-02, THME-01, THME-02]

duration: 4min
completed: 2026-04-01
---

# Phase 03 Plan 01: Theme Definitions + Tabs Store Summary

**8 dark themes with CSS custom properties and Tailwind registration, plus tabs Zustand store with per-tab pane tree isolation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T17:52:31Z
- **Completed:** 2026-04-01T17:57:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- 8 dark themes (Carbon, Graphite, Obsidian, Slate, Midnight, Void, Smoke, Ash) each with 12 CSS properties and 20 xterm colors
- CSS custom properties with data-theme selectors and Tailwind v4 @theme registration for utility class access
- Tabs store managing Tab[] with per-tab pane trees, replacing global pane-tree store
- Zero visual regression: Obsidian theme exactly matches all previous hardcoded color values

## Task Commits

Each task was committed atomically:

1. **Task 1: Theme definitions + CSS custom properties + terminal cache export** - `a714388` (feat)
2. **Task 2: Tabs store with per-tab pane trees + refactor pane-tree store** - `e2d95a4` (feat)

## Files Created/Modified
- `src/lib/themes.ts` - 8 theme definitions with CSS properties + xterm color schemes
- `src/lib/__tests__/themes.test.ts` - 13 tests for theme structure and values
- `src/index.css` - CSS custom properties for all 8 themes + Tailwind @theme block
- `src/lib/terminal-cache.ts` - Added getAllCached() export and CachedEntry type export
- `src/stores/tabs-store.ts` - Tabs Zustand store with per-tab pane trees
- `src/stores/__tests__/tabs-store.test.ts` - 17 tests for tab CRUD and pane operations
- `src/stores/pane-tree.ts` - Reduced to re-export shim from tabs-store
- `src/components/PaneContainer.tsx` - Accepts root prop instead of reading store
- `src/components/TerminalPane.tsx` - Switched to useTabsStore
- `src/App.tsx` - Switched to useTabsStore, passes root prop to PaneContainer

## Decisions Made
- Obsidian as default theme -- exact match of previous hardcoded colors for zero visual regression
- pane-tree.ts reduced to re-export shim for backward compatibility
- PaneContainer accepts root as prop to enable per-tab rendering in Plan 03

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated App.tsx to use useTabsStore**
- **Found during:** Task 2
- **Issue:** App.tsx imported usePaneTreeStore directly and used store.root -- needed update to work with new tab-scoped store
- **Fix:** Migrated App.tsx to useTabsStore, derive root/focusedPaneId from active tab, pass root as prop to PaneContainer
- **Files modified:** src/App.tsx
- **Verification:** All 61 tests pass
- **Committed in:** e2d95a4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for app to compile with new store structure. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Theme definitions and CSS tokens ready for Plans 02 and 03 to consume
- Tabs store ready for tab bar UI (Plan 02) and keyboard shortcuts (Plan 03)
- PaneContainer prop-based rendering ready for per-tab display

---
*Phase: 03-tabs-themes-statusbar*
*Completed: 2026-04-01*
