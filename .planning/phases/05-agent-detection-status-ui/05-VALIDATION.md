---
phase: 5
slug: agent-detection-status-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (frontend) + cargo test (Rust) |
| **Config file** | `vitest.config.ts` (frontend), inline in Cargo.toml (Rust) |
| **Quick run command** | `bunx vitest run --reporter=verbose` |
| **Full suite command** | `bunx vitest run && cd src-tauri && cargo test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bunx vitest run --reporter=verbose`
- **After every plan wave:** Run `bunx vitest run && cd src-tauri && cargo test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | AGNT-01 | unit (Rust) | `cd src-tauri && cargo test agent_watcher` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 0 | AGNT-02 | unit (Rust) | `cd src-tauri && cargo test agent_watcher::tests::test_known_agents` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 0 | AGNT-03 | unit (Rust) | `cd src-tauri && cargo test agent_watcher::tests::test_status_event` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 0 | AGNT-04 | unit (TS) | `bunx vitest run src/stores/__tests__/agent-store.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | AGNT-05 | unit (TS) | `bunx vitest run src/components/__tests__/AgentOverlay.test.tsx` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 1 | AGNT-06 | unit (TS) | `bunx vitest run src/components/__tests__/AgentOverlay.test.tsx` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 1 | AGNT-07 | unit (TS) | `bunx vitest run src/components/__tests__/AgentToastRegion.test.tsx` | ❌ W0 | ⬜ pending |
| 05-02-04 | 02 | 1 | AGNT-08 | unit (TS) | `bunx vitest run src/components/__tests__/AgentToastRegion.test.tsx` | ❌ W0 | ⬜ pending |
| 05-02-05 | 02 | 1 | AGNT-09 | unit (TS) | `bunx vitest run src/stores/__tests__/agent-store.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-06 | 02 | 1 | AGNT-10 | unit (TS) | `bunx vitest run src/components/__tests__/TerminalPane.test.tsx` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 1 | TABS-04 | unit (TS) | `bunx vitest run src/components/__tests__/TabBar.test.tsx` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 1 | TABS-05 | unit (TS) | `bunx vitest run src/components/__tests__/TabBar.test.tsx` | ❌ W0 | ⬜ pending |
| 05-03-03 | 03 | 1 | SIDE-03 | unit (TS) | `bunx vitest run src/components/__tests__/WorkspaceTree.test.tsx` | ✅ extend | ⬜ pending |
| 05-03-04 | 03 | 1 | SIDE-04 | unit (TS) | `bunx vitest run src/components/__tests__/WorkspaceTree.test.tsx` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/agent_watcher.rs` — Rust module + unit tests for state machine, known_agents matching
- [ ] `src/stores/__tests__/agent-store.test.ts` — agent store CRUD, toggle, computed selectors
- [ ] `src/components/__tests__/AgentOverlay.test.tsx` — overlay rendering, keyboard nav, jump action
- [ ] `src/components/__tests__/AgentToastRegion.test.tsx` — toast rendering, auto-dismiss, persist
- [ ] `src/components/__tests__/StatusDot.test.tsx` — dot rendering for each status

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Amber border glow animation | AGNT-10 | CSS animation rendering | Open terminal with agent, wait 15s, confirm amber glow appears |
| Toast positioning & stacking | AGNT-07 | Visual layout verification | Trigger multiple agent events, confirm toasts stack correctly |
| Overlay frosted glass effect | AGNT-05 | CSS backdrop-filter rendering | Open overlay (Cmd+Shift+O), verify glass effect on background |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
