---
phase: 03-tabs-themes-statusbar
plan: 02
subsystem: ui
tags: [zustand, tauri-plugin-store, css-custom-properties, xterm, theming]

requires:
  - phase: 03-01
    provides: "Theme definitions (themes.ts), CSS custom properties (index.css), terminal-cache getAllCached()"
provides:
  - "Theme Zustand store with persistence and live switching"
  - "All components use CSS custom properties instead of hardcoded hex colors"
  - "xterm.js terminals update colors live on theme change"
  - "tauri-plugin-store registered and configured"
affects: [settings-ui, session-persistence]

tech-stack:
  added: [tauri-plugin-store, "@tauri-apps/plugin-store"]
  patterns: [lazy-import-for-tauri-plugins, zustand-getState-outside-react]

key-files:
  created:
    - src/stores/theme-store.ts
    - src/stores/__tests__/theme-store.test.ts
  modified:
    - src/components/Splitter.tsx
    - src/components/PaneHeader.tsx
    - src/components/TerminalPane.tsx
    - src/components/ToastProvider.tsx
    - src/hooks/useTerminal.ts
    - src-tauri/Cargo.toml
    - src-tauri/src/lib.rs
    - src-tauri/capabilities/default.json
    - package.json
    - src/components/__tests__/PaneHeader.test.tsx

key-decisions:
  - "Lazy-import @tauri-apps/plugin-store to keep theme-store testable without Tauri runtime"
  - "useThemeStore.getState() for non-reactive reads in useEffect (Zustand pattern for outside React)"

patterns-established:
  - "Lazy dynamic import for Tauri plugins: wrap in try/catch, fail silently in tests"
  - "CSS custom properties for all component colors, no hardcoded hex in component files"

requirements-completed: [THME-02, THME-03]

duration: 3min
completed: 2026-04-01
---

# Phase 03 Plan 02: Theme Store and CSS Variable Wiring Summary

**Zustand theme store with tauri-plugin-store persistence, CSS var replacement across all components, and live xterm.js theme switching**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T17:58:52Z
- **Completed:** 2026-04-01T18:01:52Z
- **Tasks:** 1
- **Files modified:** 13

## Accomplishments
- Theme store manages current theme with DOM data-theme attribute application and xterm live color switching via terminal-cache iteration
- All hardcoded hex colors replaced with CSS custom properties in Splitter, PaneHeader, TerminalPane, ToastProvider
- tauri-plugin-store installed (Rust crate + frontend package + capability permission) for theme persistence to settings.json
- useTerminal.ts creates new terminals with theme-aware xterm colors from store

## Task Commits

Each task was committed atomically:

1. **Task 1: Theme store + replace hardcoded colors + xterm live theme switching + tauri-plugin-store** - `840d403` (feat)

## Files Created/Modified
- `src/stores/theme-store.ts` - Zustand store with setTheme (DOM + xterm + persist) and initTheme
- `src/stores/__tests__/theme-store.test.ts` - 5 tests for theme store behavior
- `src/components/Splitter.tsx` - Replaced #3b82f6/#3a3a5e/#2a2a3e with var(--accent)/var(--splitter-hover)/var(--splitter-idle)
- `src/components/PaneHeader.tsx` - Replaced rgba and hex colors with var(--bg-tertiary), var(--text-primary), var(--text-muted)
- `src/components/TerminalPane.tsx` - Replaced #3b82f6 focus border with var(--border-focus)
- `src/components/ToastProvider.tsx` - Replaced bg-[#1a1a2e] with bg-bg-tertiary Tailwind utility
- `src/hooks/useTerminal.ts` - Replaced hardcoded xterm theme with xtermThemes[currentTheme] lookup
- `src-tauri/Cargo.toml` - Added tauri-plugin-store = "2"
- `src-tauri/src/lib.rs` - Registered store plugin in builder chain
- `src-tauri/capabilities/default.json` - Added "store:default" permission
- `package.json` - Added @tauri-apps/plugin-store dependency
- `src/components/__tests__/PaneHeader.test.tsx` - Updated assertions for CSS variable values

## Decisions Made
- Lazy-import @tauri-apps/plugin-store so theme-store.ts works in test environment without Tauri runtime
- useThemeStore.getState() for reading theme in useEffect (non-reactive read, standard Zustand pattern)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated PaneHeader test assertions for CSS variables**
- **Found during:** Task 1 (verification)
- **Issue:** Existing PaneHeader tests asserted hardcoded rgb() values that no longer match after CSS var replacement
- **Fix:** Updated test expectations from rgb(224, 224, 224) to var(--text-primary) and rgb(156, 163, 175) to var(--text-muted)
- **Files modified:** src/components/__tests__/PaneHeader.test.tsx
- **Verification:** All 66 tests pass
- **Committed in:** 840d403 (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test update was a direct consequence of the color replacement. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Theme store ready for settings UI to call setTheme() with user-selected theme
- All components respond to theme changes via CSS custom properties
- xterm terminals update live when theme changes
- Ready for Plan 03 (status bar) which will also use CSS variables

---
*Phase: 03-tabs-themes-statusbar*
*Completed: 2026-04-01*
