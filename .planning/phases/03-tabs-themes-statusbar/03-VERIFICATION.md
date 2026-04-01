---
phase: 03-tabs-themes-statusbar
verified: 2026-04-01T20:25:00Z
status: human_needed
score: 11/13 must-haves verified
human_verification:
  - test: "Theme switching updates the full UI"
    expected: "Setting data-theme attribute in devtools changes all UI colors including terminal background"
    why_human: "CSS custom property cascade and xterm.js theme update require runtime/visual inspection"
  - test: "Inactive tabs preserve terminal state on switch back"
    expected: "Switching away and back to a tab shows the same terminal output (no re-spawn)"
    why_human: "display:none DOM preservation of WebGL contexts cannot be verified programmatically"
---

# Phase 03: Tabs, Themes, Status Bar Verification Report

**Phase Goal:** Multi-tab terminal management with theme system and status bar
**Verified:** 2026-04-01T20:25:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | 8 dark themes defined with 12 CSS properties each | VERIFIED | `src/lib/themes.ts` exports all 8 themes (Carbon, Graphite, Obsidian, Slate, Midnight, Void, Smoke, Ash), each with 12 `CssThemeProperties` keys and 20 xterm colors |
| 2  | `data-theme` attribute on html switches all UI colors | VERIFIED | `theme-store.ts:18` calls `document.documentElement.setAttribute('data-theme', theme)`; `index.css` has `[data-theme="*"]` selectors for all 8 themes |
| 3  | Each tab owns its own pane tree and focused pane | VERIFIED | `tabs-store.ts` `Tab` interface has `paneRoot: PaneNode` and `focusedPaneId`; all pane ops scope to active tab |
| 4  | Adding/closing/switching tabs operates correctly | VERIFIED | 17 tab store tests pass; `closeTab` on last tab spawns fresh tab (D-07) |
| 5  | xterm.js terminals update colors live when theme changes | VERIFIED (partial) | `theme-store.ts:22-24` iterates `getAllCached()` and sets `entry.term.options.theme`; needs human confirmation of runtime behavior |
| 6  | All hardcoded hex colors replaced with CSS custom properties | VERIFIED | `Splitter.tsx` uses `var(--accent/splitter-hover/splitter-idle)`; `PaneHeader.tsx` uses `var(--bg-tertiary/text-primary/text-muted)`; `TerminalPane.tsx` uses `var(--border-focus)`; `ToastProvider.tsx` uses `bg-bg-tertiary` |
| 7  | Theme selection persists via tauri-plugin-store | VERIFIED | `tauri-plugin-store = "2"` in Cargo.toml; plugin registered in `lib.rs`; `store:default` permission in capabilities; `@tauri-apps/plugin-store@^2.4.2` in package.json; lazy-import with try/catch in `theme-store.ts` |
| 8  | User can open new tabs with Cmd+T and the + button | VERIFIED | `App.tsx:93` binds `{ key: 't', meta: true, action: () => addTab() }`; `TabBar.tsx:123` has `+` button with `onClick={addTab}` |
| 9  | User can switch tabs with Cmd+1-9 and Cmd+Shift+[/] | VERIFIED | `App.tsx:95-101` registers Cmd+1-9 via `switchTabByIndex`; `App.tsx:102-103` registers Cmd+Shift+[/] via `switchTabRelative` |
| 10 | Active tab has raised border and themed background | VERIFIED | `TabBar.tsx:18-21` applies `border-t-2 border-t-accent bg-tab-active-bg` to active tab, `border-t-transparent bg-tab-inactive-bg` to inactive |
| 11 | Status bar shows pane count on the left | VERIFIED | `StatusBar.tsx:23` renders `{paneCount} {paneCount === 1 ? 'pane' : 'panes'}` derived from `countLeaves(activeTab.paneRoot)` |
| 12 | Status bar shows shortcut hints on the right | VERIFIED | `StatusBar.tsx:27-29` renders "Cmd+D Split", "Cmd+T Tab", "Cmd+Shift+O Overview" |
| 13 | Inactive tabs stay in DOM (display:none) preserving WebGL contexts | VERIFIED | `App.tsx:117` sets `display: tab.id === activeTabId ? 'block' : 'none'`; needs human confirmation of WebGL context preservation |

**Score:** 11/13 truths verified (2 need human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/themes.ts` | 8 theme definitions with CSS properties + xterm theme objects | VERIFIED | 388 lines; exports `themes`, `themeNames`, `xtermThemes`, `cssThemeProperties`, `ThemeName` |
| `src/stores/tabs-store.ts` | Tab state management with pane tree per tab | VERIFIED | 185 lines; exports `useTabsStore`, `Tab`; full CRUD + pane ops |
| `src/index.css` | CSS custom properties for all 8 themes + @theme Tailwind registration | VERIFIED | `data-theme` selectors for all 8 themes at lines 19-139; `@theme` block at line 3 |
| `src/stores/theme-store.ts` | Current theme state + persistence | VERIFIED | 54 lines; exports `useThemeStore`; DOM + xterm + persist |
| `src/components/Splitter.tsx` | Splitter with CSS var colors instead of hardcoded hex | VERIFIED | Lines 24-27 use `var(--accent)`, `var(--splitter-hover)`, `var(--splitter-idle)` |
| `src/components/PaneHeader.tsx` | Pane header with CSS var colors | VERIFIED | Lines 19,26 use `var(--bg-tertiary)`, `var(--text-primary)`, `var(--text-muted)` |
| `src/hooks/useTerminal.ts` | Terminal creation with theme-aware xterm colors | VERIFIED | Line 68 uses `xtermThemes[useThemeStore.getState().currentTheme]` |
| `src/components/TabBar.tsx` | Tab strip with scroll, +button, close buttons, active styling | VERIFIED | 131 lines (min 80 required); full scroll fade, ResizeObserver, close on hover |
| `src/components/StatusBar.tsx` | Bottom bar with pane count, shortcut hints, placeholder slots | VERIFIED | 33 lines (min 20 required); pane count + shortcut hints implemented |
| `src/App.tsx` | Root layout: TabBar + per-tab PaneContainers + StatusBar + ErrorToast | VERIFIED | Renders `<TabBar />`, `<StatusBar />`, `<ErrorToastRegion />`; per-tab `display:none` PaneContainers |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tabs-store.ts` | `pane-tree-ops.ts` | imports `splitNode`, `removeNode`, `findFirstLeaf`, `navigate`, `updateRatio`, `findLeaf` | WIRED | Lines 4-13: all 6 functions imported and used |
| `theme-store.ts` | `terminal-cache.ts` | `getAllCached()` to iterate terminals on theme change | WIRED | `theme-store.ts:3` imports `getAllCached`; line 22 iterates it |
| `theme-store.ts` | `themes.ts` | imports theme definitions for xterm | WIRED | `theme-store.ts:2` imports `xtermThemes` from themes |
| `TabBar.tsx` | `tabs-store.ts` | `useTabsStore` for tabs array, activeTabId, addTab, closeTab, switchTab | WIRED | Lines 51-55: all 5 store slices subscribed and used in render |
| `StatusBar.tsx` | `tabs-store.ts` | reads active tab's paneRoot to count leaves | WIRED | Lines 10-14: reads `tabs`, `activeTabId`, derives `paneRoot` for `countLeaves()` |
| `App.tsx` | `tabs-store.ts` | reads tabs array, renders PaneContainer per tab | WIRED | Lines 15-23: subscribed; line 113 maps tabs to PaneContainers |
| `App.tsx` | `theme-store.ts` | calls `initTheme` on mount | WIRED | Line 24 reads `initTheme`; line 27 calls it in `useEffect` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TABS-01 | 03-01, 03-03 | User can open new tabs (Cmd+T), one tab per branch/worktree | SATISFIED | `addTab()` in store; Cmd+T binding in App.tsx; + button in TabBar |
| TABS-02 | 03-01, 03-03 | User can switch tabs with Cmd+1-9 and Cmd+Shift+[/] | SATISFIED | `switchTabByIndex` + `switchTabRelative` store ops; bindings in App.tsx |
| TABS-03 | 03-03 | Active tab shows raised border and matching background | SATISFIED | `border-t-2 border-t-accent bg-tab-active-bg` on active TabItem |
| THME-01 | 03-01 | 8 built-in dark themes | SATISFIED | All 8 themes in `themes.ts` with correct names |
| THME-02 | 03-01, 03-02 | Themes applied via CSS custom properties for instant switching | SATISFIED | `data-theme` selectors + DOM attribute update in `setTheme()` |
| THME-03 | 03-02 | User selects theme in settings; stored in `~/.superagent/settings.json` | PARTIAL | Persistence mechanism implemented (tauri-plugin-store, `settings.json`); no settings UI yet (deferred to later phase) |
| STAT-01 | 03-03 | Status bar left: repo name, branch type icon, branch name, pane count | PARTIAL | Pane count implemented; repo name and branch info are empty placeholder slots — explicitly deferred to Phase 4 per plan D-18 |
| STAT-02 | 03-03 | Status bar right: agent summary, shortcut hints, Cmd+Shift+O hint | PARTIAL | Shortcut hints and Cmd+Shift+O implemented; agent summary is empty placeholder slot — explicitly deferred to Phase 5 per plan D-19 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/StatusBar.tsx` | 22 | Empty repo/branch slot (comment in plan, not in code) | Info | D-18 explicitly defers to Phase 4; placeholder structure present |
| `src/stores/pane-tree.ts` | 1-3 | Deprecated re-export shim | Info | Intentional backward-compat bridge; should be removed when all consumers migrate |

No blocker anti-patterns found.

### Human Verification Required

#### 1. Theme Live Switching

**Test:** Launch `bun tauri dev`. Open browser devtools. In console, run `document.documentElement.setAttribute('data-theme', 'void')` then try other themes (`carbon`, `midnight`, `slate`, etc.).
**Expected:** Entire UI including terminal background, tab bar, splitters, and pane headers all change color. `data-theme='obsidian'` should look identical to the pre-Phase-3 appearance.
**Why human:** CSS custom property cascade and xterm.js terminal option update require visual confirmation in a running Tauri WebView.

#### 2. Inactive Tab WebGL Context Preservation

**Test:** Open two tabs (Cmd+T). Run `echo hello` in Terminal 1. Switch to Terminal 2. Run `echo world`. Switch back to Terminal 1.
**Expected:** Terminal 1 still shows prior output — the shell is alive, no re-spawn, no blank terminal.
**Why human:** WebGL context preservation under `display:none` requires actual rendering pipeline verification.

### Requirements Note: Partial STAT-01/STAT-02 Delivery

STAT-01 and STAT-02 are marked `[x]` complete in REQUIREMENTS.md, but the full text of both requirements includes items deferred to later phases:

- **STAT-01**: Repo name, branch type icon, and branch name are empty slots (Phase 4 GIT integration)
- **STAT-02**: Agent summary ("2 working", "1 waiting") is an empty slot (Phase 5 AGNT integration)

This is documented in the plan (D-18, D-19) and the requirements checkbox reflects the plan's scoped delivery. The phase goal as verified by the plan's must_haves is fully met. The REQUIREMENTS.md checkbox is technically an overstatement of current delivery but matches the plan's intentional scope.

### Gaps Summary

No hard gaps. All automated must-haves pass. Two items require human confirmation (theme visual switching, WebGL context preservation) — both are architecture concerns that are correctly implemented in code but cannot be verified without a running app.

The partial STAT-01/STAT-02 delivery is a documented design decision (D-18/D-19), not an unintended gap.

---

_Verified: 2026-04-01T20:25:00Z_
_Verifier: Claude (gsd-verifier)_
