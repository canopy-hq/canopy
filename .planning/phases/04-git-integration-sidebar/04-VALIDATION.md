---
phase: 4
slug: git-integration-sidebar
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (frontend) + cargo test (Rust backend) |
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
| 04-01-01 | 01 | 1 | GIT-01 | unit | `cd src-tauri && cargo test git` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | GIT-02 | unit | `cd src-tauri && cargo test git` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | GIT-03 | unit | `cd src-tauri && cargo test git` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | GIT-06 | unit | `cd src-tauri && cargo test git` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | SIDE-01 | unit | `bun run test -- Sidebar` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | SIDE-02 | unit | `bun run test -- Sidebar` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | SIDE-05 | unit | `bun run test -- Sidebar` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 2 | SIDE-06 | unit | `bun run test -- WorkspaceTree` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | GIT-04 | unit | `bun run test -- CreateModal` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | GIT-05 | unit | `bun run test -- CreateModal` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/git.rs` — test module stubs for GIT-01 through GIT-03, GIT-06
- [ ] `src/components/__tests__/` — test stubs for SIDE-01, SIDE-02, SIDE-05, SIDE-06
- [ ] `src/components/__tests__/CreateModal.test.tsx` — test stubs for GIT-04, GIT-05

*Existing Vitest and cargo test infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar resize drag | SIDE-02 | Mouse interaction | Drag sidebar edge, verify min/max width constraints |
| Cmd+B toggle | SIDE-06 | Keyboard shortcut in Tauri | Press Cmd+B, verify sidebar toggles visibility |
| Native folder picker | GIT-01 | OS dialog | Click import, verify macOS folder picker opens |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
