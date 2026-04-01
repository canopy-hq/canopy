# Phase 3: Tabs + Themes + Status Bar - Research

**Researched:** 2026-04-01
**Domain:** Frontend UI (tabs, CSS theming, status bar) + Zustand state refactor
**Confidence:** HIGH

## Summary

Phase 3 adds tab management, a CSS custom-property theming system, and a status bar to the existing Tauri/React app. The core challenge is refactoring the pane-tree Zustand store to support multiple tabs (each owning its own pane tree) while preserving the terminal-cache system that keeps xterm.js instances alive across React remounts.

The theme system is straightforward: define ~12 CSS custom properties per theme, apply via `data-theme` on `<html>`, and replace all hardcoded hex values. The xterm.js `term.options.theme` setter enables live terminal theme switching without re-creating instances.

The tab bar and status bar are new UI components with no complex library dependencies -- React ARIA's `TabList`/`Tab` components can provide accessible keyboard navigation, and Tailwind handles styling.

**Primary recommendation:** Create a new `tabs-store.ts` that owns `Tab[]` + `activeTabId`, where each `Tab` contains `{ id, label, paneRoot, focusedPaneId }`. Refactor `pane-tree.ts` to operate on a given tab's pane tree rather than a global root. Do NOT try to extend the existing store shape -- a clean separation is simpler.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Rectangular tabs with rounded top corners (VS Code/iTerm2 style)
- D-02: Flexible tab width, min 120px, max 240px, shrinks evenly as tabs accumulate
- D-03: Label shows "Terminal N" -- Phase 4 replaces with repo/branch name
- D-04: Close x button per tab, visible on hover or when tab is active
- D-05: + new-tab button at end of tab strip (right of last tab)
- D-06: Horizontal scroll with left/right fade on overflow -- no wrapping
- D-07: Closing last tab spawns a fresh default tab (never zero tabs)
- D-08: Each tab owns { id, label, paneRoot, focusedPaneId } -- pane tree is per-tab
- D-09: Extend or replace pane-tree.ts Zustand store to hold Tab[] + activeTabIndex
- D-10: PaneContainer reads active tab's paneRoot instead of a global root
- D-11: ~12 CSS custom properties for theming
- D-12: 8 themes applied via data-theme attribute on html element
- D-13: Default theme: Obsidian (matches current hardcoded #0a0a14 palette)
- D-14: Theme hue map: Carbon (warm neutral), Graphite (cool gray), Obsidian (deep blue-black), Slate (blue-gray), Midnight (deep navy), Void (near-pure black), Smoke (warm brown-gray), Ash (desaturated cool-green)
- D-15: Each theme defines xterm.js terminal theme object. Updated via term.options.theme on switch
- D-16: All hardcoded hex values replaced with var(--token) references
- D-17: Status bar 24px height, subtle top border, muted text, themed
- D-18: Left: pane count ("3 panes"). Repo/branch slots rendered but empty
- D-19: Right: shortcut hints. Agent summary slot empty

### Claude's Discretion
- Exact hex values for 8 theme palettes (within hue direction specified)
- ANSI 16-color palette per theme
- Tab bar height and exact spacing
- Status bar typography and spacing
- Tab scroll fade implementation details
- Store architecture (extend pane-tree.ts vs new tabs.ts store)

### Deferred Ideas (OUT OF SCOPE)
- Tab drag-to-reorder
- Tab renaming (Phase 4)
- Theme customization UI (v2)
- TABS-04/05 agent status on tabs (Phase 5)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TABS-01 | User can open new tabs (Cmd+T), one tab per branch/worktree | Tab store + keyboard registry extension + xterm custom key handler update |
| TABS-02 | User can switch tabs with Cmd+1-9 and Cmd+Shift+[/] | Keyboard registry bindings + xterm passthrough |
| TABS-03 | Active tab shows raised border and matching background | CSS custom properties + tab component styling |
| THME-01 | 8 built-in dark themes | CSS custom property definitions per theme in index.css |
| THME-02 | Themes applied via CSS custom properties for instant switching | data-theme attribute on html + var() token usage |
| THME-03 | User selects theme in settings; stored in ~/.superagent/settings.json | tauri-plugin-store persistence (already in deps) |
| STAT-01 | Status bar left: repo name, branch type icon, branch name, pane count | StatusBar component; pane count from store; repo/branch empty slots for Phase 4 |
| STAT-02 | Status bar right: agent summary, shortcut hints, Cmd+Shift+O hint | StatusBar right section; agent summary empty slot for Phase 5 |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.x | Tab + pane state management | Already used for pane-tree; extend with tab store |
| immer | 11.x | Immutable state updates | Already middleware in pane-tree store |
| react-aria-components | 1.16.0 | Accessible TabList/Tab primitives | Already installed; WAI-ARIA tab pattern built in |
| tailwindcss | 4.2.x | Utility styling + CSS custom properties | Already installed |
| @xterm/xterm | 6.0 | Terminal theme API | `term.options.theme = {...}` for live switching |
| tauri-plugin-store | 2.4 | Persist theme selection | Already in Cargo.toml; key-value JSON store |

### No New Dependencies Required
This phase requires zero new packages. All needed functionality exists in the current stack.

## Architecture Patterns

### Recommended Project Structure
```
src/
  stores/
    tabs-store.ts         # NEW: Tab[] + activeTabId + tab CRUD
    pane-tree.ts          # REFACTORED: operates on active tab's tree
    theme-store.ts        # NEW: currentTheme + setTheme + persist
  components/
    TabBar.tsx            # NEW: tab strip with scroll, +button
    Tab.tsx               # NEW: single tab component
    StatusBar.tsx         # NEW: bottom bar
    PaneContainer.tsx     # MODIFIED: reads active tab's paneRoot
    Splitter.tsx          # MODIFIED: use CSS vars
    PaneHeader.tsx        # MODIFIED: use CSS vars
    TerminalPane.tsx      # MODIFIED: use CSS vars for focus border
    ToastProvider.tsx     # MODIFIED: use CSS vars
  lib/
    themes.ts             # NEW: theme definitions (CSS props + xterm theme objects)
  index.css               # MODIFIED: CSS custom property declarations per data-theme
  App.tsx                 # MODIFIED: layout = TabBar + PaneContainer + StatusBar
```

### Pattern 1: Tab Store (new Zustand store)
**What:** Separate store that owns the tab array and active tab selection. Each tab contains its own pane tree root and focused pane ID.
**When to use:** Always -- this is the core state model for Phase 3.
**Example:**
```typescript
// src/stores/tabs-store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { PaneNode, PaneId } from '../lib/pane-tree-ops';

interface Tab {
  id: string;
  label: string;
  paneRoot: PaneNode;
  focusedPaneId: PaneId | null;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  switchTabByIndex: (index: number) => void;
  switchTabRelative: (direction: 'prev' | 'next') => void;
  // Pane operations now scoped to active tab
  getActiveTab: () => Tab | undefined;
  updateActiveTabPaneRoot: (root: PaneNode) => void;
  updateActiveTabFocusedPane: (paneId: PaneId | null) => void;
}
```

**Key design point:** The existing `usePaneTreeStore` actions (splitPane, closePane, navigate, etc.) should be refactored to operate on the active tab's pane tree. Two approaches:
1. Move all pane actions into tabs-store (single store) -- simpler, fewer subscriptions
2. Keep pane-tree.ts but make it read/write from the active tab in tabs-store -- more modular

**Recommendation:** Single store (approach 1). The pane tree is always scoped to a tab, so separating them creates unnecessary synchronization complexity. Rename to `workspace-store.ts` or keep `pane-tree.ts` but expand it.

### Pattern 2: CSS Custom Property Theming
**What:** Define theme tokens as CSS custom properties on `[data-theme="name"]` selectors.
**When to use:** For all color values across the app.
**Example:**
```css
/* src/index.css */
@import "tailwindcss";

:root, [data-theme="obsidian"] {
  --bg-primary: #0a0a14;
  --bg-secondary: #12121f;
  --bg-tertiary: #1a1a2e;
  --border: #2a2a3e;
  --border-focus: #3b82f6;
  --text-primary: #e0e0e0;
  --text-muted: #9ca3af;
  --accent: #3b82f6;
  --tab-active-bg: #1a1a2e;
  --tab-inactive-bg: #0a0a14;
  --splitter-idle: #2a2a3e;
  --splitter-hover: #3a3a5e;
}

[data-theme="void"] {
  --bg-primary: #050508;
  --bg-secondary: #0a0a0f;
  /* ... */
}
```

**Tailwind v4 integration:** Use `@theme` directive to register custom properties so Tailwind utilities can reference them:
```css
@theme {
  --color-bg-primary: var(--bg-primary);
  --color-bg-secondary: var(--bg-secondary);
  --color-text-primary: var(--text-primary);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
  --color-border-focus: var(--border-focus);
  --color-accent: var(--accent);
}
```
Then use `bg-bg-primary`, `text-text-primary`, `border-border` etc. in Tailwind classes.

### Pattern 3: xterm.js Live Theme Switching
**What:** Update terminal colors without re-creating instances.
**When to use:** Whenever theme changes.
**Example:**
```typescript
// Each theme exports an ITheme-compatible object
const xtermThemes: Record<string, ITheme> = {
  obsidian: {
    background: '#0a0a14',
    foreground: '#e0e0e0',
    cursor: '#e0e0e0',
    selectionBackground: '#3b82f680',
    black: '#1a1a2e',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e0e0e0',
    brightBlack: '#6b7280',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#f9fafb',
  },
  // ... other themes
};

// On theme change, iterate all cached terminals:
function applyTerminalTheme(themeName: string) {
  const theme = xtermThemes[themeName];
  for (const [, entry] of terminalCache) {
    entry.term.options.theme = theme;
  }
}
```

### Pattern 4: Tab Scroll with Fade
**What:** Horizontal scroll on tab strip with CSS gradient mask for fade effect.
**Example:**
```css
.tab-strip {
  overflow-x: auto;
  scrollbar-width: none; /* Firefox */
  mask-image: linear-gradient(
    to right,
    transparent 0,
    black 24px,
    black calc(100% - 24px),
    transparent 100%
  );
}
.tab-strip::-webkit-scrollbar { display: none; }
```
Conditionally apply mask only when content overflows (detect via `scrollWidth > clientWidth` in a ResizeObserver or scroll event handler).

### Anti-Patterns to Avoid
- **Global pane root with tab switching:** Do NOT keep a single global `root` and swap it when tabs change. This causes React to unmount/remount all terminal panes unnecessarily. Instead, render each tab's PaneContainer but hide inactive ones with `display: none` (keeps DOM alive, preserves xterm instances).
- **Re-creating terminals on tab switch:** Terminal instances are expensive (WebGL context). The existing terminal-cache keyed by ptyId already handles this -- just ensure inactive tab panes stay in DOM.
- **Inline hex values:** After this phase, zero hardcoded color values should remain in components.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessible tab keyboard nav | Custom tab key handling | react-aria TabList/Tab | Handles arrow keys, Home/End, focus management per WAI-ARIA |
| Color contrast validation | Manual hex comparison | HSL math in theme definitions | Ensures readability across all 8 themes |
| Theme persistence | Custom file I/O | tauri-plugin-store | Already configured, handles async disk writes |

## Common Pitfalls

### Pitfall 1: WebGL Context Exhaustion on Tab Switch
**What goes wrong:** If inactive tab panes are unmounted, their WebGL contexts are destroyed. Switching back re-creates them, hitting the browser's ~16 context limit.
**Why it happens:** React unmounts components not in the render tree.
**How to avoid:** Render ALL tabs' PaneContainers in the DOM. Use `display: none` or `visibility: hidden` + `position: absolute` for inactive tabs. The terminal-cache already preserves xterm instances if their DOM element stays attached.
**Warning signs:** Blank terminals or "WebGL context lost" errors after switching tabs.

### Pitfall 2: Cmd+1-9 Conflicts with macOS/Terminal
**What goes wrong:** Cmd+number may be intercepted by macOS or by the WebView.
**Why it happens:** Tauri's WebView inherits some system key handling.
**How to avoid:** The existing `attachCustomKeyEventHandler` in useTerminal.ts must be updated to return `false` for Cmd+1-9, Cmd+T, and Cmd+Shift+[/] so they bubble to the keyboard registry. Also register these in the Tauri accelerator config if needed.
**Warning signs:** Key combos do nothing or trigger wrong behavior.

### Pitfall 3: Stale Pane Tree Reference After Tab Switch
**What goes wrong:** Components still subscribed to old pane tree root after switching tabs.
**Why it happens:** Zustand selectors may cache previous tab's root.
**How to avoid:** Use a selector pattern that depends on `activeTabId`: `useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId)?.paneRoot)`. Or derive active tab's root as a computed field.
**Warning signs:** Splits/closes affect wrong tab's layout.

### Pitfall 4: CSS Custom Properties + Tailwind v4 Theme Registration
**What goes wrong:** Tailwind utilities like `bg-[var(--bg-primary)]` work but are verbose. Missing `@theme` registration means no shorthand.
**Why it happens:** Tailwind v4 requires explicit `@theme` block to extend the default design tokens.
**How to avoid:** Register theme tokens in `@theme` block so you can write `bg-bg-primary` instead of `bg-[var(--bg-primary)]`.
**Warning signs:** Inconsistent class naming between custom property usage and Tailwind utility usage.

### Pitfall 5: Obsidian Theme Regression
**What goes wrong:** After refactoring to CSS custom properties, the default look changes subtly.
**Why it happens:** Missed a hardcoded color or wrong mapping.
**How to avoid:** Document every hardcoded color in the current codebase and map it 1:1 to an Obsidian theme token. Current inventory:

| Current Value | Location | Theme Token |
|---------------|----------|-------------|
| `#0a0a14` | App.tsx bg, index.css, useTerminal.ts theme.background | `--bg-primary` |
| `#1a1a2e` | PaneHeader bg rgba(26,26,46), ToastProvider bg | `--bg-tertiary` |
| `#e0e0e0` | PaneHeader focused color, useTerminal fg/cursor | `--text-primary` |
| `#9ca3af` | PaneHeader unfocused color | `--text-muted` |
| `#3b82f6` | TerminalPane focus border, Splitter active | `--accent` / `--border-focus` |
| `#2a2a3e` | Splitter idle | `--splitter-idle` |
| `#3a3a5e` | Splitter hover | `--splitter-hover` |
| `border-red-500/30`, `bg-[#1a1a2e]` | ToastProvider | Keep Tailwind red for error semantics; bg uses `--bg-tertiary` |

## Code Examples

### Tab Keyboard Shortcut Registration
```typescript
// In App.tsx, extend the bindings array:
{ key: 't', meta: true, action: () => addTab() },
{ key: 'w', meta: true, action: () => {
  // If single pane in tab, close tab; else close pane
  const tab = getActiveTab();
  if (tab && tab.paneRoot.type === 'leaf') {
    closeTab(tab.id);
  } else {
    handleClose();
  }
}},
// Cmd+1 through Cmd+9
...Array.from({ length: 9 }, (_, i) => ({
  key: String(i + 1), meta: true, action: () => switchTabByIndex(i),
})),
// Cmd+Shift+[ and Cmd+Shift+]
{ key: '[', meta: true, shift: true, action: () => switchTabRelative('prev') },
{ key: ']', meta: true, shift: true, action: () => switchTabRelative('next') },
```

### xterm Custom Key Handler Update
```typescript
// In useTerminal.ts attachCustomKeyEventHandler, add:
if (e.key === 't' && !e.shiftKey) return false;  // Cmd+T
if (e.key >= '1' && e.key <= '9') return false;   // Cmd+1-9
if ((e.key === '[' || e.key === ']') && e.shiftKey) return false; // Cmd+Shift+[/]
```

### Terminal Cache Iteration for Theme Switching
```typescript
// Extend terminal-cache.ts:
export function getAllCached(): Map<number, CachedEntry> {
  return cache;
}

// In theme-store.ts or a useEffect:
import { getAllCached } from '../lib/terminal-cache';
import { xtermThemes } from '../lib/themes';

function applyXtermTheme(themeName: string) {
  const theme = xtermThemes[themeName];
  if (!theme) return;
  for (const [, entry] of getAllCached()) {
    entry.term.options.theme = theme;
  }
}
```

### App Layout After Phase 3
```tsx
// App.tsx return:
<div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-primary">
  <TabBar />
  <div className="flex-1 min-h-0 relative">
    {tabs.map(tab => (
      <div
        key={tab.id}
        className="absolute inset-0"
        style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
      >
        <PaneContainer root={tab.paneRoot} />
      </div>
    ))}
  </div>
  <StatusBar />
  <ErrorToastRegion />
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CSS-in-JS theming (styled-components) | CSS custom properties + data attributes | 2023+ standard | No runtime JS cost, instant switching |
| Global CSS vars on :root only | Scoped via data-theme on html | Standard pattern | Multiple theme scopes possible |
| xterm.js theme set at construction | `term.options.theme = newTheme` (live) | xterm 5+ | No terminal re-creation needed |
| Tailwind v3 theme.extend in config | Tailwind v4 @theme in CSS | 2025 (v4) | Config-free, CSS-native |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x + @testing-library/react |
| Config file | vitest.config.ts |
| Quick run command | `bun run test` |
| Full suite command | `bun run test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TABS-01 | addTab creates new tab with sentinel pane | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "addTab"` | No -- Wave 0 |
| TABS-01 | Closing last tab spawns fresh tab | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "close last"` | No -- Wave 0 |
| TABS-02 | switchTabByIndex selects correct tab | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchByIndex"` | No -- Wave 0 |
| TABS-02 | switchTabRelative wraps around | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchRelative"` | No -- Wave 0 |
| TABS-03 | Active tab styling | manual-only | Visual verification | N/A |
| THME-01 | 8 themes defined with correct token count | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "8 themes"` | No -- Wave 0 |
| THME-02 | Theme switch applies data-theme attribute | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "data-theme"` | No -- Wave 0 |
| THME-03 | Theme persisted to store | unit | `bunx vitest run src/stores/__tests__/theme-store.test.ts` | No -- Wave 0 |
| STAT-01 | Status bar shows pane count | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "pane count"` | No -- Wave 0 |
| STAT-02 | Status bar shows shortcut hints | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "shortcut"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/stores/__tests__/tabs-store.test.ts` -- covers TABS-01, TABS-02
- [ ] `src/lib/__tests__/themes.test.ts` -- covers THME-01, THME-02
- [ ] `src/stores/__tests__/theme-store.test.ts` -- covers THME-03
- [ ] `src/components/__tests__/StatusBar.test.tsx` -- covers STAT-01, STAT-02

## Open Questions

1. **Cmd+W behavior: close pane vs close tab**
   - What we know: Currently Cmd+W closes the focused pane. With tabs, when there's a single pane left in a tab, should Cmd+W close the tab?
   - Recommendation: Yes -- if active tab has a single leaf pane, Cmd+W closes the tab. Closing the last tab creates a fresh one (D-07). This matches iTerm2/VS Code behavior.

2. **Tab counter for labels ("Terminal N")**
   - What we know: D-03 says "Terminal N" label
   - Recommendation: Use a monotonic counter stored in the tabs store. Never reuse numbers within a session. Reset on app restart.

3. **Theme persistence timing**
   - What we know: THME-03 says stored in ~/.superagent/settings.json via tauri-plugin-store
   - What's unclear: tauri-plugin-store is a Rust plugin -- the frontend needs to call it via Tauri IPC. The store plugin may need initialization in the Tauri app builder.
   - Recommendation: Check if tauri-plugin-store is already registered in src-tauri/src/lib.rs. If not, add `.plugin(tauri_plugin_store::Builder::default().build())` and use `@tauri-apps/plugin-store` on the frontend.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: All source files in src/ examined directly
- xterm.js 6.0 API: `term.options.theme` setter -- confirmed by existing usage pattern in useTerminal.ts
- Zustand 5.x: immer middleware pattern -- confirmed by existing pane-tree.ts

### Secondary (MEDIUM confidence)
- Tailwind v4 `@theme` directive: documented in Tailwind v4 docs
- CSS `mask-image` for scroll fade: standard CSS property, wide browser support

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed, APIs verified from codebase usage
- Architecture: HIGH - tab store pattern is standard Zustand, CSS custom properties are well-established
- Pitfalls: HIGH - WebGL context exhaustion is documented in Phase 2 STATE.md blockers; hardcoded color inventory is complete

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain, no fast-moving dependencies)
