---
phase: 2
slug: split-panes-keyboard
status: draft
nyquist_compliant: false
wave_0_complete: false
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

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | TERM-02, TERM-03, TERM-05, TERM-06 | unit | `bun run test -- pane-tree-ops` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | KEYS-01, KEYS-02, KEYS-03 | unit | `bun run test -- keybinding` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | TERM-04 | unit | `bun run test -- PaneHeader` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | TERM-06 | unit | `cargo test -p superagent --lib` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/pane-tree-ops.test.ts` — stubs for TERM-02, TERM-03, TERM-05, TERM-06 (pure tree operations)
- [ ] `src/hooks/__tests__/useKeyboardRegistry.test.ts` — stubs for KEYS-01, KEYS-02, KEYS-03
- [ ] `src/components/__tests__/PaneHeader.test.tsx` — stubs for TERM-04
- [ ] Rust: `close_pty` unit test in `pty.rs` mod tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WebGL context budget under load | TERM-02 | Requires real WebGL contexts in browser | Open 9+ panes, verify no rendering crash |
| Splitter drag feel | TERM-03 | Subjective UX interaction | Drag splitters, verify smooth resize |
| OSC 7 CWD detection | TERM-04 | Depends on user shell config | cd to new dir, verify header updates |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
