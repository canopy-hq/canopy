---
phase: 2
slug: split-panes-keyboard
status: draft
nyquist_compliant: true
created: 2026-04-01
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 + @testing-library/react (TS), cargo test (Rust) |
| **Config file** | vitest.config.ts (TS), src-tauri/Cargo.toml (Rust) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && cd src-tauri && cargo test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test && cd src-tauri && cargo test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Test Strategy: TDD Within Tasks

Tests are created TDD-style (RED then GREEN) within each task that has `tdd="true"`. There is no separate Wave 0 phase. Each TDD task creates its test file as the first step of the RED phase, then implements code to pass. Non-TDD tasks that create testable components include test creation as part of the task action.

This approach ensures:
- Test files exist before implementation code (TDD tasks)
- No orphaned test stubs that may drift from implementation
- Each task is self-contained: creates tests + implementation in one commit cycle

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Test Type | Automated Command | TDD | Status |
|---------|------|-------------|-----------|-------------------|-----|--------|
| 02-01-01 | 01 | TERM-02, TERM-03, TERM-05, TERM-06 | unit | `bun run test -- pane-tree-ops` | yes (RED/GREEN within task) | pending |
| 02-01-02 | 01 | KEYS-01, KEYS-02, KEYS-03 | unit | `bun run test -- useKeyboardRegistry` | yes (RED/GREEN within task) | pending |
| 02-01-03 | 01 | TERM-06 | unit | `cargo test -p superagent --lib` | no (inline test in pty.rs) | pending |
| 02-02-01 | 02 | TERM-04 | unit | `bun run test -- PaneHeader` | no (test created in task action) | pending |
| 02-02-02 | 02 | TERM-02, TERM-03 | typecheck | `bun run typecheck` | no | pending |
| 02-03-01 | 03 | KEYS-01, KEYS-02, KEYS-03, TERM-02, TERM-05, TERM-06 | integration | `bun run test && bun run typecheck` | no | pending |
| 02-03-02 | 03 | cleanup | regression | `bun run test && cargo check` | no | pending |
| 02-03-03 | 03 | all | manual | Human verify 11-point checklist | no | pending |

*Status: pending / green / red / flaky*

---

## Test Files Created by Plans

| Test File | Created In | Requirements Covered |
|-----------|-----------|---------------------|
| `src/lib/__tests__/pane-tree-ops.test.ts` | Plan 01, Task 1 (TDD RED phase) | TERM-02, TERM-03, TERM-05, TERM-06 |
| `src/hooks/__tests__/useKeyboardRegistry.test.ts` | Plan 01, Task 2 (TDD RED phase) | KEYS-01, KEYS-02, KEYS-03 |
| `src/components/__tests__/PaneHeader.test.tsx` | Plan 02, Task 1 | TERM-04 |
| Rust `mod tests` in `pty.rs` | Plan 01, Task 3 | TERM-06 (close_pty) |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WebGL context budget under load | TERM-02 | Requires real WebGL contexts in browser | Open 9+ panes, verify no rendering crash |
| Splitter drag feel | TERM-03 | Subjective UX interaction | Drag splitters, verify smooth resize |
| OSC 7 CWD detection | TERM-04 | Depends on user shell config | cd to new dir, verify header updates |
| Last pane close sentinel respawn | TERM-06 | End-to-end PTY lifecycle | Close all panes, verify new terminal spawns |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Tests created TDD-style within tasks (no separate Wave 0 needed)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
