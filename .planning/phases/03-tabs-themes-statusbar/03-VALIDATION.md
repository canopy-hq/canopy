---
phase: 03
slug: tabs-themes-statusbar
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x + @testing-library/react |
| **Config file** | vitest.config.ts |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | THME-01 | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "8 themes"` | created-by-task | ⬜ pending |
| 03-01-02 | 01 | 1 | THME-02 | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "data-theme"` | created-by-task | ⬜ pending |
| 03-01-03 | 01 | 1 | TABS-01 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "addTab"` | created-by-task | ⬜ pending |
| 03-01-04 | 01 | 1 | TABS-01 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "close last"` | created-by-task | ⬜ pending |
| 03-01-05 | 01 | 1 | TABS-02 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchByIndex"` | created-by-task | ⬜ pending |
| 03-01-06 | 01 | 1 | TABS-02 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchRelative"` | created-by-task | ⬜ pending |
| 03-02-01 | 02 | 2 | THME-03 | unit | `bunx vitest run src/stores/__tests__/theme-store.test.ts` | created-by-task | ⬜ pending |
| 03-03-01 | 03 | 3 | TABS-03 | manual | Visual verification | N/A | ⬜ pending |
| 03-03-02 | 03 | 3 | STAT-01 | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "pane count"` | created-by-task | ⬜ pending |
| 03-03-03 | 03 | 3 | STAT-02 | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "shortcut"` | created-by-task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All 4 test files are created inline by their respective plan tasks (TDD pattern). No separate Wave 0 scaffolding needed:

- `src/lib/__tests__/themes.test.ts` — created by Plan 01 Task 1 (TDD)
- `src/stores/__tests__/tabs-store.test.ts` — created by Plan 01 Task 2 (TDD)
- `src/stores/__tests__/theme-store.test.ts` — created by Plan 02 Task 1
- `src/components/__tests__/StatusBar.test.tsx` — created by Plan 03 Task 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Active tab raised border + matching bg | TABS-03 | Visual styling verification | 1. Open 2+ tabs 2. Click between them 3. Verify active has raised border and themed bg |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all created-by-task, no separate W0 needed)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
