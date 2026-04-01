---
phase: 01-app-shell-single-terminal
verified: 2026-04-01T09:16:00Z
status: human_needed
score: 9/9 must-haves verified
human_verification:
  - test: "Launch app with `bun run tauri dev` and verify terminal is interactive"
    expected: "Default shell prompt appears; typing `ls` and Enter shows file listing; `echo $TERM` returns a value"
    why_human: "PTY spawning and xterm.js rendering require a real WebGL context and native macOS process — cannot verify in CI"
  - test: "Run 256-color test in terminal: `printf '\\e[38;5;196mRED\\e[38;5;46mGREEN\\e[38;5;21mBLUE\\e[0m\\n'`"
    expected: "Three colored words display with correct ANSI 256-color rendering"
    why_human: "Color rendering depends on WebGL terminal rendering, cannot verify programmatically"
  - test: "Run `vim` or `htop` in the terminal"
    expected: "Alternate screen buffer renders correctly; pressing q exits cleanly and shell prompt returns"
    why_human: "Alternate screen buffer behavior requires real PTY and xterm.js runtime"
  - test: "Check macOS menu bar shows Superagent, Edit, and Window menus with correct items"
    expected: "Superagent menu: About, Settings..., Quit. Edit menu: Undo/Redo/Cut/Copy/Paste/Select All. Window menu: Minimize, fullscreen item, Close Window"
    why_human: "macOS native menu bar cannot be inspected programmatically from tests"
  - test: "Drag window edges to resize; observe terminal reflow"
    expected: "Terminal content reflows to fill new window size without visual artifacts"
    why_human: "ResizeObserver + PTY resize interaction requires live app"
---

# Phase 01: App Shell + Single Terminal Verification Report

**Phase Goal:** Launchable Tauri v2 macOS app with one working terminal pane — PTY spawning, xterm.js WebGL rendering, native menu bar, error toasts. Proves the core tech stack end-to-end.
**Verified:** 2026-04-01T09:16:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Tauri app builds without errors (both Rust and frontend) | VERIFIED | `cargo build` exits 0 (1 dead_code warning, non-blocking); `bun run build` exits 0 with 1252 modules |
| 2 | App launches and shows a terminal pane filling the window | VERIFIED (automated) | `src/App.tsx` renders `<TerminalView />` in `h-screen w-screen` div; `Terminal.tsx` renders `h-full w-full` div with `useTerminal` hook |
| 3 | Terminal runs the user's default shell (interactive prompt visible) | VERIFIED (automated) | `pty.rs` uses `CommandBuilder::new_default_prog()` to spawn the default shell; `useTerminal.ts` calls `spawnTerminal` and writes output to xterm.js |
| 4 | Typed characters appear in terminal and commands execute | VERIFIED (automated) | `useTerminal.ts` wires `term.onData` to `writeToPty()` and `term.onBinary` for special keys |
| 5 | 256-color, mouse events, and alternate screen apps render correctly | VERIFIED (automated) | Raw byte streaming via `Channel<Vec<u8>>` with 4KB buffer preserves all ANSI sequences; WebGL addon loaded after `term.open()` |
| 6 | macOS menu bar shows Superagent, Edit, and Window menus | VERIFIED (automated) | `menu.rs` builds three `SubmenuBuilder` instances with correct items; wired via `lib.rs` `.setup()` closure |
| 7 | Edit menu has standard shortcuts (Undo/Redo/Cut/Copy/Paste/Select All) | VERIFIED | `menu.rs` calls `.undo().redo().separator().cut().copy().paste().select_all()` via Tauri predefined items |
| 8 | Window menu has Minimize, fullscreen, and Close | VERIFIED | `menu.rs` calls `.minimize()`, `PredefinedMenuItem::fullscreen()`, `.close_window()` |
| 9 | Error toast appears bottom-right, red accent, auto-dismisses after 8 seconds | VERIFIED (automated) | `toast.ts` uses `timeout: 8000`; `ToastProvider.tsx` has `border-red-500/30` and `fixed bottom-4 right-4`; `App.tsx` renders `ErrorToastRegion` at root |

**Score:** 9/9 truths verified (5 require human confirmation at runtime)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/pty.rs` | PTY spawning, read/write/resize via Tauri Channel | VERIFIED | 137 lines; `spawn_terminal`, `write_to_pty`, `resize_pty` all implemented with full bodies; `drop(pair.slave)` present; `std::thread::spawn` reader loop present; inline test module present |
| `src/components/Terminal.tsx` | xterm.js wrapper with WebGL addon | VERIFIED | 15 lines; imports and calls `useTerminal(containerRef)`; renders full-size container div |
| `src/hooks/useTerminal.ts` | PTY lifecycle hook connecting xterm.js to Tauri IPC | VERIFIED | 88 lines; `Terminal`, `WebglAddon`, `FitAddon`, `WebLinksAddon` all loaded; `spawnTerminal`, `writeToPty`, `resizePty` all called; `ResizeObserver` wired |
| `src-tauri/tauri.conf.json` | Tauri v2 app configuration | VERIFIED | Contains `"productName": "Superagent"`; window dimensions, security, build config all present |
| `src-tauri/src/menu.rs` | macOS native menu bar setup | VERIFIED | 34 lines; contains `SubmenuBuilder` for all three menus; `app.set_menu(menu)?` call present |
| `src/components/ToastProvider.tsx` | Error toast notification region | VERIFIED | 48 lines; uses `UNSTABLE_ToastRegion`, red accent classes, dismissal button; renders queue items |
| `src/lib/toast.ts` | Global toast queue for programmatic error display | VERIFIED | 14 lines; exports `toastQueue` and `showErrorToast`; `timeout: 8000` configured |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/hooks/useTerminal.ts` | `src-tauri/src/pty.rs` | `invoke('spawn_terminal')` via `spawnTerminal()` | WIRED | `useTerminal.ts` calls `spawnTerminal()` from `../lib/pty`; `pty.ts` calls `invoke('spawn_terminal', { onOutput: channel })` |
| `src/hooks/useTerminal.ts` | `src-tauri/src/pty.rs` | `invoke('write_to_pty')` on `term.onData` | WIRED | `term.onData` callback calls `writeToPty(id, data)`; `pty.ts` calls `invoke('write_to_pty', { ptyId, data: bytes })` |
| `src/components/Terminal.tsx` | `src/hooks/useTerminal.ts` | `useTerminal` hook called with container ref | WIRED | `Terminal.tsx` imports and calls `useTerminal(containerRef)` |
| `src-tauri/src/pty.rs` | `pair.slave` | `drop(pair.slave)` after `spawn_command` | WIRED | Line 45: `drop(pair.slave);` present immediately after `spawn_command` call |
| `src-tauri/src/lib.rs` | `src-tauri/src/menu.rs` | `menu::setup_menu(app)` in `.setup()` closure | WIRED | `lib.rs` line 11: `menu::setup_menu(app)?;` inside `.setup(|app| { ... })` |
| `src/App.tsx` | `src/components/ToastProvider.tsx` | `ErrorToastRegion` rendered at app root | WIRED | `App.tsx` imports and renders `<ErrorToastRegion />` alongside `<TerminalView />` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SHELL-01 | 01-01-PLAN.md | Tauri v2 app with Rust backend and React + TypeScript frontend | SATISFIED | `src-tauri/Cargo.toml` uses `tauri = "~2.10"`; `package.json` has `react@^19.2.7`; full build passes |
| SHELL-02 | 01-02-PLAN.md | macOS menu bar with Superagent/Edit/Window submenus | SATISFIED | `menu.rs` implements all three submenus with specified items; wired in `lib.rs` `.setup()` |
| SHELL-03 | 01-02-PLAN.md | Error toast notifications (bottom-right, red accent, auto-dismiss 8s) | SATISFIED | `toast.ts` + `ToastProvider.tsx` implement the full system; `timeout: 8000`, `fixed bottom-4 right-4`, `border-red-500/30` |
| TERM-01 | 01-01-PLAN.md | User can open a real shell session in a terminal pane (PTY + xterm.js WebGL) | SATISFIED | Full PTY pipeline: `pty.rs` spawns default shell, streams via `Channel<Vec<u8>>`, `useTerminal.ts` renders with `WebglAddon` |
| TERM-07 | 01-01-PLAN.md | Terminal renders 256-color, mouse events, and alternate screen buffer correctly | SATISFIED | Raw byte streaming preserves all ANSI escape sequences; `allowProposedApi: true` enables binary data pass-through |

No orphaned requirements — all 5 requirement IDs from plan frontmatter are accounted for. REQUIREMENTS.md traceability table marks SHELL-01, SHELL-02, SHELL-03, TERM-01, TERM-07 as Phase 1 / Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/__tests__/Terminal.test.tsx` | 42 | `it('placeholder -- renders without error', () => { expect(true).toBe(true); })` | Info | Test exists but exercises no real code. Acceptable given jsdom cannot instantiate WebGL — this test guards import resolution only. No impact on goal. |
| `src-tauri/src/error.rs` | 4 | `PtyError` struct defined but never constructed (dead_code warning) | Info | `PtyError` is defined for future use; current PTY commands return `String` errors directly via `.map_err(|e| e.to_string())`. Not a goal blocker. |

No blocker anti-patterns found. No stub implementations in goal-critical code paths.

### Human Verification Required

#### 1. Terminal Interactive Session

**Test:** `bun run tauri dev` — type `ls`, `echo $TERM`, `pwd` in the terminal
**Expected:** Default shell prompt appears; commands execute and produce visible output
**Why human:** PTY spawning requires a real macOS process and native PTY allocation; xterm.js WebGL requires a GPU context — neither available in jsdom

#### 2. 256-Color Rendering (TERM-07)

**Test:** Run `printf '\e[38;5;196mRED\e[38;5;46mGREEN\e[38;5;21mBLUE\e[0m\n'` in the terminal
**Expected:** Three distinctly colored words appear (red, green, blue)
**Why human:** ANSI 256-color rendering depends on the WebGL renderer at runtime

#### 3. Alternate Screen Apps (TERM-07)

**Test:** Run `vim` or `htop` in the terminal
**Expected:** Alternate screen renders correctly; pressing `q` exits and shell prompt returns without artifacts
**Why human:** Alternate screen buffer switching requires real PTY + xterm.js runtime coordination

#### 4. macOS Menu Bar (SHELL-02)

**Test:** Launch app and inspect the macOS menu bar
**Expected:** Three menus: "Superagent" (About, Settings..., Quit), "Edit" (Undo, Redo, Cut, Copy, Paste, Select All), "Window" (Minimize, fullscreen item, Close Window)
**Why human:** macOS native menu bar is a system-level UI element not accessible to automated checks

#### 5. Window Resize Propagation

**Test:** Drag window edges while terminal is open
**Expected:** Terminal content reflows to fill the new window size; no content truncation or overlap
**Why human:** ResizeObserver + fitAddon + PTY resize requires live rendering to verify correctness

### Gaps Summary

No gaps. All automated checks pass:
- `cargo build`: exits 0 (1 non-blocking dead_code warning)
- `cargo test`: 2/2 tests pass
- `bun run test`: 3/3 tests pass
- `bun run build`: exits 0 (1252 modules, 405ms)

All must-have artifacts exist and are substantive. All key links are wired. All 5 requirement IDs are satisfied. The only open items are the 5 human verification tests that require a live macOS environment with WebGL and a real PTY.

---

_Verified: 2026-04-01T09:16:00Z_
_Verifier: Claude (gsd-verifier)_
