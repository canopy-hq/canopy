---
quick_id: 260401-wei
description: "Fix terminal isolation: only render active tab PaneContainer"
status: complete
date: 2026-04-01
commit: df7ba88
---

## What Changed

Replaced `display:none` tab hiding with conditional rendering in App.tsx. Only the active tab's `PaneContainer` is now mounted in the DOM. Inactive tabs are fully unmounted.

## Why

xterm.js WebGL canvases don't respect CSS `display:none` on parent divs, causing inactive tabs' terminals to bleed through visually. When switching workspace items in the sidebar, the old terminals remained visible behind the new tab.

## How It Works

- Active tab: `PaneContainer` mounted → xterm.js terminals render normally
- Tab switch away: `PaneContainer` unmounts → `useTerminal` cleanup detaches xterm DOM elements from container, keeps them in terminal-cache
- Tab switch back: `PaneContainer` remounts → `useTerminal` finds cached entries, reparents xterm DOM into new container → scrollback, CWD, running processes all preserved

## Key Files

- `src/App.tsx` — conditional rendering of PaneContainer (7 insertions, 9 deletions)

## Tests

All 113 tests pass. No test changes needed.
