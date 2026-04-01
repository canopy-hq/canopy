---
phase: 03
slug: tabs-themes-statusbar
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 03-01-01 | 01 | 1 | TABS-01 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "addTab"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | TABS-01 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "close last"` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | TABS-02 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchByIndex"` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | TABS-02 | unit | `bunx vitest run src/stores/__tests__/tabs-store.test.ts -t "switchRelative"` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | THME-01 | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "8 themes"` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | THME-02 | unit | `bunx vitest run src/lib/__tests__/themes.test.ts -t "data-theme"` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | THME-03 | unit | `bunx vitest run src/stores/__tests__/theme-store.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | TABS-03 | manual | Visual verification | N/A | ⬜ pending |
| 03-03-02 | 03 | 2 | STAT-01 | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "pane count"` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | STAT-02 | unit | `bunx vitest run src/components/__tests__/StatusBar.test.tsx -t "shortcut"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/stores/__tests__/tabs-store.test.ts` — stubs for TABS-01, TABS-02
- [ ] `src/lib/__tests__/themes.test.ts` — stubs for THME-01, THME-02
- [ ] `src/stores/__tests__/theme-store.test.ts` — stubs for THME-03
- [ ] `src/components/__tests__/StatusBar.test.tsx` — stubs for STAT-01, STAT-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Active tab raised border + matching bg | TABS-03 | Visual styling verification | 1. Open 2+ tabs 2. Click between them 3. Verify active has raised border and themed bg |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
