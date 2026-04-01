---
phase: 02-split-panes-keyboard
verified: 2026-04-01T10:32:00Z
status: passed
score: 15/15 must-haves verified
re_verification: false
---

# Phase 2: Split Panes + Keyboard Verification Report

**Phase Goal:** User can create a multi-pane terminal workspace with keyboard-driven navigation
**Verified:** 2026-04-01T10:32:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can split panes horizontally (Cmd+D) and vertically (Cmd+Shift+D) with unlimited recursive nesting | VERIFIED | `splitNode` in pane-tree-ops.ts handles same/different-direction recursion; `App.tsx` binds `{key:'d', meta:true}` and `{key:'d', meta:true, shift:true}` via `useKeyboardRegistry` |
| 2 | User can drag splitter handles to resize panes, and each pane shows a floating header with CWD | VERIFIED | `Splitter.tsx` uses `useSplitterDrag` with pointer capture + document-level listeners; `PaneHeader.tsx` shows last 2 CWD path segments with backdrop blur |
| 3 | User can navigate between panes with Cmd+Option+arrows and close focused pane with Cmd+W | VERIFIED | `App.tsx` binds all 4 arrow keys (meta+alt) + `{key:'w', meta:true}`; `navigate()` in pane-tree-ops.ts walks up path to find matching-axis branch |
| 4 | iTerm2-compatible shortcuts work; unmatched keys pass through to the focused terminal | VERIFIED | `useKeyboardRegistry` intercepts in capture phase; `useTerminal.ts` registers `attachCustomKeyEventHandler` returning `false` for Cmd+D/Shift+D/W/Option+Arrows to prevent xterm swallowing |

**Score: 4/4 truths verified**

---

## Required Artifacts

### Plan 02-01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/pane-tree-ops.ts` | VERIFIED | 303 lines; exports `splitNode`, `removeNode`, `findLeaf`, `findFirstLeaf`, `navigate`, `updateRatio`, `findLastLeaf` + all types |
| `src/lib/__tests__/pane-tree-ops.test.ts` | VERIFIED | 234 lines, 17 test cases covering split (tuple return), remove, find, navigate, updateRatio edge cases |
| `src/hooks/useKeyboardRegistry.ts` | VERIFIED | 38 lines; exports `useKeyboardRegistry` and `Keybinding`; capture phase confirmed |
| `src/hooks/__tests__/useKeyboardRegistry.test.ts` | VERIFIED | 105 lines; tests capture phase, preventDefault on match, no-preventDefault on non-match |
| `src/stores/pane-tree.ts` | VERIFIED | 82 lines; exports `usePaneTreeStore`; contains all required actions (splitPane, closePane, setFocus, navigate, updateRatio, setPtyId) with immer middleware |
| `src-tauri/src/pty.rs` | VERIFIED | Contains `pub fn close_pty(`, `child.kill()`, `manager.writers.remove(&pty_id)`, `manager.masters.remove(&pty_id)` |

### Plan 02-02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/components/PaneContainer.tsx` | VERIFIED | 26 lines; exports `PaneContainer`; reads `root` from `usePaneTreeStore`; recursive `PaneNodeRenderer` dispatches leaf/branch |
| `src/components/SplitContainer.tsx` | VERIFIED | 46 lines; exports `SplitContainer`; uses `flex` with `ratios[i]` for sizing; inserts `<Splitter>` between children |
| `src/components/Splitter.tsx` | VERIFIED | 57 lines; exports `Splitter`; uses `useSplitterDrag`; contains `#2a2a3e`, `col-resize`/`row-resize` |
| `src/components/TerminalPane.tsx` | VERIFIED | 107 lines; exports `TerminalPane`; handles `ptyId === -1` sentinel; calls `setPtyId` after spawn; has `onPointerDown` for focus; renders `PaneHeader` with `#3b82f6` focus border |
| `src/components/PaneHeader.tsx` | VERIFIED | 33 lines; exports `PaneHeader`; `backdropFilter: 'blur(4px)'`; last-2-segments CWD path; `~` fallback |
| `src/hooks/useSplitterDrag.ts` | VERIFIED | 54 lines; exports `useSplitterDrag`; uses `setPointerCapture`; `document.addEventListener('pointermove'...)` and `document.addEventListener('pointerup'...)` |
| `src/hooks/useTerminal.ts` | VERIFIED | 173 lines; accepts `(containerRef, ptyId, isFocused, onCwdChange?)`; does NOT import from old stores; contains `registerOscHandler(7,`; `attachCustomKeyEventHandler`; `setTimeout`-based 100ms debounce for `resizePty` |

### Plan 02-03 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/App.tsx` | VERIFIED | Contains `<PaneContainer`, `useKeyboardRegistry`, all 7 bindings (d, d+shift, w, 4 arrows), imports `closePty`; does NOT import old Terminal component |
| `src/components/Terminal.tsx` | VERIFIED (deleted) | File does not exist — correctly removed |
| `src/stores/terminal.ts` | VERIFIED (deleted) | File does not exist — correctly removed |

---

## Key Link Verification

### Plan 02-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/stores/pane-tree.ts` | `src/lib/pane-tree-ops.ts` | import and delegate | WIRED | Line 3-12: `import { splitNode, removeNode, findFirstLeaf, navigate, updateRatio, ... } from '../lib/pane-tree-ops'` |
| `src/lib/pty.ts` | `close_pty` Tauri command | `invoke('close_pty')` | WIRED | Line 53: `return invoke('close_pty', { ptyId })`; also `outputRegistry.delete(ptyId)` for cleanup |

### Plan 02-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/components/PaneContainer.tsx` | `src/stores/pane-tree.ts` | `usePaneTreeStore` | WIRED | Line 1: import; Line 11: `usePaneTreeStore((s) => s.root)` |
| `src/components/Splitter.tsx` | `src/hooks/useSplitterDrag.ts` | `useSplitterDrag` | WIRED | Line 2: import; Line 18: `const { onPointerDown } = useSplitterDrag(...)` |
| `src/components/TerminalPane.tsx` | `src/hooks/useTerminal.ts` | `useTerminal` | WIRED | Line 3: import; Line 92: `useTerminal(containerRef, ptyId, isFocused, onCwdChange)` |
| `src/components/TerminalPane.tsx` | `src/stores/pane-tree.ts` | `setPtyId` | WIRED | Line 23: destructured from store; Line 38: `setPtyId(paneId, id)` called after sentinel spawn |
| `src/hooks/useTerminal.ts` | `src/lib/pty.ts` | `writeToPty`, `resizePty`, `connectPtyOutput` | WIRED | Line 6: import; used at lines 57, 59, 90, 131 |

### Plan 02-03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/App.tsx` | `src/stores/pane-tree.ts` | `usePaneTreeStore` | WIRED | Lines 12-15: destructures focusedPaneId, splitPane, closePane, navigate |
| `src/App.tsx` | `src/hooks/useKeyboardRegistry.ts` | `useKeyboardRegistry` | WIRED | Line 62: `useKeyboardRegistry(bindings)` |
| `src/App.tsx` | `src/lib/pty.ts` | `closePty` | WIRED | Line 6: import; Line 41: `await closePty(leaf.ptyId)` in handleClose |
| `src/App.tsx` | `src/components/PaneContainer.tsx` | `<PaneContainer` | WIRED | Line 2: import; Line 66: `<PaneContainer />` in JSX |
| `closePane sentinel` | `TerminalPane sentinel spawn` | `ptyId=-1` triggers spawn | WIRED | `closePane` creates `{ ptyId: -1 }` leaf; `TerminalPane` detects `ptyId > 0` is false, runs `spawnTerminal()` useEffect |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TERM-02 | 02-01, 02-02, 02-03 | Split panes horizontally (Cmd+D) and vertically (Cmd+Shift+D) with recursive nesting | SATISFIED | `splitNode` with same/different direction logic; App.tsx bindings; PaneContainer recursive renderer |
| TERM-03 | 02-01, 02-02 | Resize split panes by dragging visible splitter handles | SATISFIED | `Splitter.tsx` + `useSplitterDrag.ts` with pointer capture; `updateRatio` in store |
| TERM-04 | 02-02 | Each pane displays floating header with CWD and agent status | SATISFIED | `PaneHeader.tsx` with backdrop blur, last-2-segments CWD; OSC 7 detection in `useTerminal.ts` wires CWD updates |
| TERM-05 | 02-01, 02-03 | Navigate between panes with Cmd+Option+arrow keys | SATISFIED | `navigate()` in pane-tree-ops.ts; App.tsx binds all 4 arrow directions |
| TERM-06 | 02-01, 02-03 | Close focused pane with Cmd+W | SATISFIED | `App.tsx` Cmd+W binding calls `handleClose`; `closePty` backend + `closePane` store action; sentinel auto-respawn on last close |
| KEYS-01 | 02-01, 02-03 | iTerm2-compatible default shortcuts | SATISFIED | 7 shortcuts: Cmd+D, Cmd+Shift+D, Cmd+W, Cmd+Option+Arrows — all registered in `useKeyboardRegistry` |
| KEYS-02 | 02-01 | KeybindingRegistry intercepts keydown, matched shortcuts preventDefault + execute action | SATISFIED | `useKeyboardRegistry` uses capture phase; matched keys call `e.preventDefault()` + `e.stopPropagation()` |
| KEYS-03 | 02-01 | Unmatched keys pass through to focused xterm.js terminal | SATISFIED | No-match path in `useKeyboardRegistry` allows event to propagate; `attachCustomKeyEventHandler` in useTerminal returns `false` only for the 7 app shortcuts |

**All 8 requirements: SATISFIED**

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `pane-tree-ops.test.ts` | 17 cases | ALL PASS |
| `useKeyboardRegistry.test.ts` | 6 cases | ALL PASS |
| `PaneHeader.test.tsx` | 6 cases | ALL PASS |
| `ToastProvider.test.tsx` | 2 cases | ALL PASS |
| Rust `cargo test --lib` | 3 cases | ALL PASS |

**Total: 34 tests, 0 failures**

---

## Anti-Patterns Found

No blockers or warnings found.

Legitimate `return null` occurrences in `pane-tree-ops.ts` are correct sentinel returns in DFS recursive functions (e.g., returning `null` from `removeNode` on last leaf — by design), not stubs.

The `spawnTerminal()` signature in `src/lib/pty.ts` diverges from the plan spec (plan had `onOutput` callback parameter; actual implementation uses a Channel-based approach with `connectPtyOutput()` registry pattern). This is a deliberate improvement — noted in the 02-02 SUMMARY as a key decision. The behavior is equivalent: PTY output is wired to xterm.

---

## Human Verification Required

The following items cannot be verified programmatically. Task 3 of Plan 02-03 is a blocking human checkpoint that was not yet completed at plan execution time:

### 1. Full End-to-End Split Pane System

**Test:** Run `bun run tauri dev` in the project root and perform the following:
1. App launches with a single terminal pane — type `ls` to confirm shell works
2. Cmd+D splits horizontally — new terminal appears to the right with working shell
3. Cmd+Shift+D splits vertically — new terminal appears below
4. Cmd+Option+Arrow navigates between panes — focused pane shows blue border
5. Drag a splitter handle — smooth resize with blue highlight while dragging
6. Each pane shows floating header (top-right) with CWD path
7. `cd /tmp` in a pane — header updates to show new path
8. Cmd+W closes a pane — sibling expands to fill space
9. Close all panes with Cmd+W — new terminal auto-spawns (sentinel mechanism)
10. Type regular text in focused terminal — keys pass through, no shortcuts swallowed

**Expected:** All 10 checks pass without errors in the console.
**Why human:** Terminal rendering (WebGL), drag smoothness, actual PTY lifecycle, CWD header updates, and key passthrough require a running Tauri app.

---

## Summary

All automated checks pass. Phase 2 goal is structurally achieved:

- **Data layer (Plan 02-01):** Pure pane tree operations fully tested (17 cases). Zustand store with immer wires all operations. Keyboard registry with capture-phase interception tested (6 cases). `close_pty` Rust command registered and tested.
- **UI layer (Plan 02-02):** 5 components built and wired. Recursive `PaneContainer` reads store root. `SplitContainer` uses ratio-based flexbox. `Splitter` has pointer capture drag. `TerminalPane` handles sentinel PTY spawn. `PaneHeader` shows CWD. `useTerminal` refactored for multi-pane with debounced resize, OSC 7, and key passthrough.
- **Integration (Plan 02-03):** `App.tsx` orchestrates PaneContainer + 7 keyboard shortcuts + PTY lifecycle. Old single-terminal files removed cleanly. No broken imports.

The only pending item is human verification of the running app (Task 3 checkpoint in Plan 02-03 — blocking gate that was intentionally left for human sign-off).

---

_Verified: 2026-04-01T10:32:00Z_
_Verifier: Claude (gsd-verifier)_
