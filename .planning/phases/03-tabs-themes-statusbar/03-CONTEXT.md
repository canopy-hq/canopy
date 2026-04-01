# Phase 3: Tabs + Themes + Status Bar - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Tab management (open, switch, close), 8 built-in dark themes via CSS custom properties, and a status bar. Each tab owns its own pane tree. Requirements: TABS-01, TABS-02, TABS-03, THME-01, THME-02, THME-03, STAT-01, STAT-02.

</domain>

<decisions>
## Implementation Decisions

### Tab bar design
- **D-01:** Rectangular tabs with rounded top corners (VS Code/iTerm2 style)
- **D-02:** Flexible tab width, min 120px, max 240px, shrinks evenly as tabs accumulate
- **D-03:** Label shows "Terminal N" — Phase 4 replaces with repo/branch name
- **D-04:** Close `x` button per tab, visible on hover or when tab is active
- **D-05:** `+` new-tab button at end of tab strip (right of last tab)
- **D-06:** Horizontal scroll with left/right fade on overflow — no wrapping
- **D-07:** Closing last tab spawns a fresh default tab (never zero tabs)

### Tab state model
- **D-08:** Each tab owns { id, label, paneRoot, focusedPaneId } — pane tree is per-tab
- **D-09:** Extend or replace `pane-tree.ts` Zustand store to hold `Tab[]` + `activeTabIndex`
- **D-10:** `PaneContainer` reads active tab's `paneRoot` instead of a global root

### Theme system
- **D-11:** ~12 CSS custom properties: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--border-focus`, `--text-primary`, `--text-muted`, `--accent`, `--tab-active-bg`, `--tab-inactive-bg`, `--splitter-idle`, `--splitter-hover`
- **D-12:** 8 themes applied via `data-theme` attribute on `<html>` element
- **D-13:** Default theme: Obsidian (matches current hardcoded `#0a0a14` palette — zero visual regression)
- **D-14:** Theme hue map: Carbon (warm neutral), Graphite (cool gray), Obsidian (deep blue-black), Slate (blue-gray), Midnight (deep navy), Void (near-pure black), Smoke (warm brown-gray), Ash (desaturated cool-green)
- **D-15:** Each theme defines an xterm.js terminal `theme` object (bg, fg, cursor, ANSI 16). Updated via `term.options.theme = newTheme` on switch
- **D-16:** All hardcoded hex values in existing components (Splitter, TerminalPane, PaneHeader, ToastProvider, useTerminal xterm theme) replaced with `var(--token)` references

### Status bar
- **D-17:** 24px height, subtle top border, muted text, themed via same CSS custom properties
- **D-18:** Left: pane count ("3 panes"). Repo/branch slots rendered but empty — Phase 4 fills them
- **D-19:** Right: shortcut hints ("Cmd+D Split  Cmd+T Tab  Cmd+Shift+O Overview"). Agent summary slot empty — Phase 5 fills it

### Claude's Discretion
- Exact hex values for the 8 theme palettes (within the hue direction specified above)
- ANSI 16-color palette per theme
- Tab bar height and exact spacing
- Status bar typography and spacing
- Tab scroll fade implementation details
- Store architecture (extend pane-tree.ts vs new tabs.ts store)

</decisions>

<specifics>
## Specific Ideas

- Obsidian theme must match current app look exactly — upgrading should be invisible
- Tab bar should feel like iTerm2/VS Code — familiar to terminal power users
- Status bar is informational, not interactive — no buttons, just text

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and in:
- `.planning/REQUIREMENTS.md` — TABS-01..03, THME-01..03, STAT-01..02 definitions
- `.planning/ROADMAP.md` §Phase 3 — success criteria and dependency chain

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/stores/pane-tree.ts`: Zustand + immer store — extend with tabs array or extract pane tree into tab objects
- `src/hooks/useKeyboardRegistry.ts`: Capture-phase interceptor — add Cmd+T, Cmd+1-9, Cmd+Shift+[/] bindings
- `src/hooks/useTerminal.ts`: xterm.js lifecycle — `term.options.theme` setter for live theme switching
- `src/lib/terminal-cache.ts`: Terminal instance cache keyed by ptyId — survives tab switches without re-creating terminals

### Established Patterns
- Keyboard registry: `Keybinding[]` array with `{ key, meta, shift, alt, action }` — extend for tab shortcuts
- Sentinel PTY pattern: `ptyId: -1` means "spawn on mount" — new tabs get sentinel leaf, TerminalPane handles spawn
- Inline `style={{}}` for dynamic values, Tailwind utilities for layout — theme tokens replace inline hex values

### Integration Points
- `src/App.tsx`: Root layout — insert `<TabBar>` above and `<StatusBar>` below `<PaneContainer>`
- `src/components/PaneContainer.tsx`: Currently reads global `root` — must read active tab's root instead
- `src/index.css`: Add CSS custom property definitions and `[data-theme]` selectors
- `src/hooks/useTerminal.ts` lines 67-72: Hardcoded xterm theme object — replace with theme-aware values
- `src/components/Splitter.tsx`: Hardcoded border colors — replace with CSS custom properties
- `src/components/PaneHeader.tsx`: Hardcoded `rgba(26, 26, 46, 0.85)` — replace with themed token
- `src/components/ToastProvider.tsx`: Hardcoded colors — replace with themed tokens

</code_context>

<deferred>
## Deferred Ideas

- Tab drag-to-reorder — nice-to-have, not in Phase 3
- Tab renaming — not needed until Phase 4 when tabs get repo/branch labels
- Theme customization UI — explicitly out of scope (v2)
- TABS-04/05 (agent status on tabs) — Phase 5

</deferred>

---

*Phase: 03-tabs-themes-statusbar*
*Context gathered: 2026-04-01*
