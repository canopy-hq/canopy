---
phase: 1
slug: app-shell-single-terminal
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (frontend), cargo test (Rust backend) |
| **Config file** | `vitest.config.ts` / `src-tauri/Cargo.toml` |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && cd src-tauri && cargo test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test && cd src-tauri && cargo test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-00 | 01 | 0 | — | scaffold | `bun run test` | Yes (W0) | ⬜ pending |
| 1-01-01 | 01 | 1 | SHELL-01 | unit | `cd src-tauri && cargo check` | Yes (W0) | ⬜ pending |
| 1-01-02 | 01 | 1 | TERM-01 | unit | `cd src-tauri && cargo test` | Yes (W0) | ⬜ pending |
| 1-02-01 | 02 | 2 | SHELL-02, SHELL-03 | unit | `bun run test && cd src-tauri && cargo test` | Yes (W0) | ⬜ pending |
| 1-02-02 | 02 | 2 | — | checkpoint | `bun run test && cd src-tauri && cargo test` | Yes (W0) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src-tauri/src/pty.rs` — inline `#[cfg(test)] mod tests` with PTY manager stubs (created in 01-01 Task 1)
- [x] `src/components/__tests__/Terminal.test.tsx` — mocked xterm.js/Tauri placeholder tests (created in 01-01 Task 0)
- [x] `src/components/__tests__/ToastProvider.test.tsx` — toast queue placeholder tests (created in 01-01 Task 0)
- [x] `vitest.config.ts` — Vitest configuration (created in 01-01 Task 1)
- [x] Test runner scripts in `package.json` (created in 01-01 Task 1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 256-color rendering | TERM-01 | Visual verification needed | Run `msgcat --color=test` in terminal, verify color output |
| Mouse events in vim | TERM-01 | Requires interactive terminal | Open vim, verify mouse click positions cursor |
| Alternate screen apps | TERM-01 | Visual + interactive | Run `htop`, verify full-screen rendering and navigation |
| macOS menu bar | SHELL-02 | Native OS integration | Verify menu items appear, shortcuts work |
| Toast notifications | SHELL-03 | Visual + timing | Trigger error, verify toast appears bottom-right with auto-dismiss |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
