# Project Research Summary

**Project:** Superagent
**Domain:** Desktop terminal emulator with AI agent management (macOS, Tauri v2 + React)
**Researched:** 2026-03-31
**Confidence:** HIGH

## Executive Summary

Superagent is a native macOS desktop app that combines real terminal emulation with git worktree-centric workspace management and built-in AI agent status monitoring. Experts build this class of app with a Tauri v2 (Rust backend) + React frontend split: Rust owns PTY management, git operations, process inspection, and session persistence; React owns the UI layout tree, terminal rendering via xterm.js, and state display. The Tauri IPC bridge uses events for streaming terminal data and commands for one-shot operations. This architecture is well-documented, with reference implementations in Canopy and TUICommander.

The recommended approach is a strict phase order driven by hard dependencies: first a working terminal (PTY + xterm.js), then the split-pane layout engine, then tab and multi-terminal management, then git workspace model and sidebar, then agent detection and status UI, and finally session persistence and polish. Skipping ahead breaks things — agent features depend on the git workspace model, which depends on working terminals. The killer differentiator (agent status indicators + branch-centric tabs) cannot be validated without a solid terminal foundation.

The highest risks are in Phase 1 and Phase 2: IPC bottleneck on terminal data streaming (must batch PTY output from day one), PTY/xterm.js resize race condition (must debounce at 150-200ms), and WebGL context exhaustion for multi-pane layouts (must implement a context budget system). All three require architectural decisions at the start — retrofitting any of them is painful. Tauri v2 capability misconfiguration and PTY process leaks are also first-phase concerns.

## Key Findings

### Recommended Stack

The stack is Tauri 2.10 + React 19 + TypeScript 5.x on the frontend, with portable-pty 0.9, git2 0.20, and sysinfo 0.33+ as the three core Rust backend crates. xterm.js 6.0 with the WebGL addon is the terminal renderer (Canvas renderer was removed in v6 — WebGL is the only GPU path). Zustand 5.x manages frontend state (interconnected layout/tab/agent state fits Zustand's single-store model better than Jotai atoms). Tailwind CSS v4 + react-aria-components handles styling and accessible UI primitives. Vite 8 (Rolldown-based) and Bun provide fast developer tooling.

The key toolchain choice is using portable-pty directly rather than the immature tauri-plugin-pty (v0.1.x), which constrains PTY lifecycle control needed for multi-terminal split panes. git2 is opened per command invocation (not cached in state) because it is not Send/Sync and opens cheaply (~microseconds). Tauri events (not commands) are used for PTY data streaming — critical architectural constraint.

**Core technologies:**
- Tauri 2.10: App shell, Rust backend, WebKit webview — ~600KB binary, native perf, mature 2.10.x line
- React 19 + TypeScript 5.x: UI framework — stable, massive ecosystem, Activity component useful for hidden pane prerendering
- xterm.js 6.0 + WebGL addon: Terminal rendering — WebGL-only renderer, latest major, greenfield so no migration needed
- portable-pty 0.9: PTY management — battle-tested (powers WezTerm), direct lifecycle control over spawning/resizing/killing
- git2 0.20: Git operations — Rust-native libgit2, thread-safe, worktree support, no shell exec
- sysinfo 0.33+: Agent detection — cross-platform process enumeration, 2s polling interval
- Zustand 5.x: Frontend state — accessible outside React (needed for Tauri IPC handlers), fits interconnected state model
- Tailwind CSS v4: Styling — 5x faster builds, CSS custom properties for theming
- Vite 8: Bundler — Rolldown-based (Rust), 10-30x faster than previous

### Expected Features

Superagent occupies a unique position: the only native desktop app combining real terminal + git worktree workspace model + built-in agent status monitoring. CMUX is the closest competitor but targets agent-as-driver (agents control the terminal). Superagent targets human-as-driver (human monitors agents).

**Must have (table stakes):**
- Real terminal emulation (PTY + xterm.js WebGL, 256-color, mouse events, alternate screen buffer)
- Split panes (horizontal + vertical, recursive, drag-to-resize) — every competitor has this
- Tab management (Cmd+T/W/1-9) — baseline, non-negotiable
- Keyboard shortcuts (iTerm2-compatible) — macOS developers have muscle memory
- Dark themes (2-3 good ones: night owl, monokai, catppuccin) — 100% of developer terminals ship dark
- macOS-native menus (About, Cmd+,, Cmd+Q, standard Edit/Window)
- Settings panel (shell, theme, keybindings, workspace paths)
- Fast startup, low memory — Tauri delivers ~600KB binary; keep JS bundle small

**Should have (differentiators):**
- Agent detection + status indicators (pane border dot, tab badge, sidebar dot) — THE killer feature; no other terminal shows "Claude is thinking" inline; amber glow for "waiting" is #1 pain point
- Branch/worktree-centric workspace model (one tab = one branch/worktree) — mental model shift that matches how developers actually work with AI agents
- Sidebar with git-native metadata (branch status, agent dots, worktree type) — unique information density
- Create branch/worktree modal (type cards, git command preview, one-click create + open tab)
- Agent overview overlay (Cmd+Shift+A, grid of all agents with status, click to jump)
- Cross-workspace agent notifications (toast + sidebar ambient update when agent finishes on background branch)
- Agent-aware status bar ("3 agents running, 1 waiting" at a glance)
- Session persistence (layout, tabs, working directories on relaunch)

**Defer (v2+):**
- Plugin/extension system — need usage data first
- Linux/Windows support — validate on macOS before cross-platform complexity
- Team/collaborative features — requires auth + backend infrastructure
- Built-in AI chat or agent orchestration — Warp and Overstory own this; Superagent manages agents, doesn't be one
- Token/cost tracking — dedicated tools (Agent Watch, Datadog) do this better
- Theme customization UI — ship good defaults, accept PRs

### Architecture Approach

The architecture is a three-layer Tauri v2 pattern: Rust backend (PTY Manager using portable-pty, Git Service using git2, Agent Detector using sysinfo, Session Store), Tauri IPC bridge (events for streaming data, commands for request/response), and React frontend (Split Pane Tree as recursive binary tree with flex ratios, Sidebar, Tab Bar, xterm.js instances, Overlays). Frontend owns the layout tree; backend owns the PTY map. They are connected by IDs. Git2 Repository is opened per command, not cached. PTY data flows via events (fire-and-forget, low latency); git operations flow via commands (typed, async, request/response).

**Major components:**
1. PTY Manager (Rust) — spawn/destroy shell processes, read/write PTY fds, resize via portable-pty; per-PTY tokio task for continuous reads
2. Git Service (Rust) — branch listing, worktree CRUD, repo status via git2; opened fresh per command invocation
3. Agent Detector (Rust) — 2s sysinfo polling, walk PTY child process trees, diff against previous state, emit status-changed events
4. Split Pane Tree (React) — recursive binary tree, flex ratios (not pixels), DFS for split/close, ResizeObserver for fit
5. Session Store (Rust) — serialize layout + tabs to JSON on change, validate all references on restore, graceful degradation for deleted entities
6. xterm.js Instances (React) — WebGL addon, useTerminal hook manages full lifecycle, context budget (WebGL only for visible panes)

### Critical Pitfalls

1. **IPC bottleneck on terminal data streaming** — batch PTY output on the Rust side over a 16ms window before emitting; never use invoke for terminal data; use Tauri events only. Must solve in Phase 1, cannot retrofit.
2. **xterm.js / PTY resize race condition** — debounce resize events at 150-200ms before calling FitAddon.fit() and sending SIGWINCH to PTY; use ResizeObserver not window resize. Must solve during split-pane work.
3. **WebGL context exhaustion** — browsers cap WebGL contexts at 8-16; 4 tabs x 4 panes = 16 instances hits the limit. Implement context budget: WebGL only for visible/focused panes, dispose WebGL addon on tab hide, canvas fallback for background terminals. Must design into tab/pane system from day one.
4. **PTY lifecycle and zombie process leaks** — PTY registry in Rust with process group signaling (SIGHUP then SIGKILL) on pane close; crash handler kills all PTYs on panic; periodic reaper for zombies. Must build into PTY spawning from day one.
5. **Tauri v2 capability misconfiguration** — define dedicated capability file for the main window with exact permissions; test in release mode early (not just tauri dev); never use wildcard shell/process permissions. Must set up at scaffold time.

Additional moderate pitfalls: xterm.js disposal memory leaks (use a dedicated `useTerminal` hook), FitAddon erratic behavior in flexbox (check `getBoundingClientRect()` before calling fit, debounce at 200ms), git2 incomplete worktree support (build trait abstraction with CLI fallback early), agent detection false positives/negatives (match full command line scoped to PTY child tree, configurable regex patterns), state restore crashes (validate all references on load, schema versioning, graceful degradation).

## Implications for Roadmap

Based on research, the dependency graph is clear and enforces a specific phase order. There are 7 natural build phases with well-defined deliverables.

### Phase 1: App Shell + Single Terminal
**Rationale:** Everything depends on a working terminal. PTY Manager, xterm.js rendering, Tauri IPC event pattern, and capability configuration must all be solid before any other feature is built. Bugs here cascade into every phase.
**Delivers:** Tauri v2 scaffold, one working terminal pane (PTY + xterm.js WebGL), PTY read loop via tokio::task::spawn_blocking, IPC event transport for terminal data with 16ms output batching, Tauri capability file.
**Addresses:** Real terminal emulation (table stakes #1), macOS-native app shell
**Avoids:** IPC bottleneck (#1), PTY zombie leaks (#4), capability misconfiguration (#5), blocking async runtime (#12), shell environment inheritance (#13)
**Research flag:** Well-documented Tauri pattern — no additional research-phase needed. Reference: Canopy repo.

### Phase 2: Split Pane System
**Rationale:** Split panes are table stakes and the structural container for all subsequent features. The binary tree layout engine with flex ratios must be solid before tabs add another dimension.
**Delivers:** Recursive binary tree layout state (TypeScript), React renderer for split panes, drag-to-resize with ratio adjustment, ResizeObserver-based fit with 200ms debounce, WebGL context budget (dispose on hide, restore on show), useTerminal lifecycle hook.
**Addresses:** Split panes (table stakes #2), keyboard shortcuts for pane navigation
**Avoids:** Resize race condition (#2), WebGL context exhaustion (#3), xterm.js disposal leaks (#6), FitAddon erratic behavior (#7)
**Research flag:** Well-documented. Warp's blog post on split pane tree structures is the reference implementation.

### Phase 3: Tab Bar + Multi-Terminal
**Rationale:** Tabs depend on the pane system (tabs contain pane layouts) and the PTY lifecycle (one PTY per tab minimum). This phase also introduces the branch/worktree tab concept conceptually, even before git integration.
**Delivers:** Tab state in Zustand, tab creation/close/reorder, Cmd+T/W/1-9 keyboard shortcuts, PTY-per-tab lifecycle, PTY registry with kill-on-tab-close, macOS menus (Cmd+Q, Cmd+, etc.), 2-3 dark themes via Tailwind CSS custom properties.
**Addresses:** Tab management (table stakes #3), keyboard shortcuts (table stakes #5), dark themes (table stakes #7), macOS menus (table stakes #8)
**Avoids:** PTY zombie leaks (#4) — PTY registry built here, State restore crashes (#10) — tab state schema defined here

### Phase 4: Git Integration + Sidebar
**Rationale:** The git workspace model is Superagent's conceptual differentiator. It can partially parallel Phase 2-3 (git2 has no frontend deps) but the sidebar UI needs the tab system to be functional. This phase establishes the branch/worktree-centric mental model.
**Delivers:** Git Service (git2, open-per-call pattern), sidebar with workspace/repo list, branch and worktree display, branch status (ahead/behind), create branch/worktree modal, branch/worktree-centric tab model (tab = branch).
**Addresses:** Sidebar navigation (table stakes #6), branch/worktree workspace model (differentiator #2), create worktree modal (differentiator #5), git-native sidebar metadata (differentiator #6)
**Avoids:** git2 worktree gaps (#8) — build trait abstraction with CLI fallback; timer-based git polling anti-pattern — use fs watcher on .git/HEAD instead
**Research flag:** May need shallow research-phase for git2 worktree API edge cases (locked worktrees, detached HEAD, bare repos). Validate against real repos early.

### Phase 5: Agent Detection + Status UI
**Rationale:** Agent features are the killer differentiator but depend on both terminal infrastructure (PTY child PIDs) and the git workspace model (agents run in branches). This phase builds the unique value proposition.
**Delivers:** Agent Detector (sysinfo 2s polling, PTY child tree scoped, regex patterns for known agents), Tauri events for status changes, agent status indicators (pane border glow, tab badge, sidebar dot), agent overview overlay (Cmd+Shift+A), cross-workspace toast notifications, agent-aware status bar.
**Addresses:** Agent detection + indicators (differentiator #1), agent overview overlay (differentiator #3), cross-workspace notifications (differentiator #4), agent-aware status bar (differentiator #7)
**Avoids:** Agent detection false positives (#9) — scoped to PTY child tree, configurable regex, full command line matching
**Research flag:** Agent binary name patterns need validation (claude, aider, codex, cursor-agent naming conventions may have shifted). Light research on current agent process names recommended.

### Phase 6: Session Persistence
**Rationale:** Session persistence is deferred until the full tab/pane/workspace model is stable. Serializing an unstable schema wastes effort. Now that all entities (tabs, panes, branches, worktrees) are defined, the schema can be finalized.
**Delivers:** JSON session schema with schema version, layout + tabs + focused pane + window geometry saved on change and on clean exit, restore with full reference validation (workspace path, branch, worktree), graceful degradation for deleted entities (placeholder pane with error), periodic 30s save for crash recovery, tauri-plugin-store for atomic persistence.
**Addresses:** Session persistence (table stakes #4)
**Avoids:** State restore crashes (#10) — validate all references, schema versioning from day one
**Research flag:** Standard pattern — no additional research needed.

### Phase 7: Settings Panel + Polish
**Rationale:** Settings and polish require all other features to be stable to know what to expose and how to configure. Keyboard shortcut overrides depend on knowing all shortcuts. Theme polish depends on all UI components existing.
**Delivers:** Settings panel (Cmd+,) with shell selection, theme switcher, keybinding overrides, workspace path management. Final keyboard shortcut pass. WebKit rendering validation across all themes. Performance audit (PTY batching, xterm.js frame rate). App distribution prep.
**Addresses:** Settings panel (table stakes #9), fast startup/low memory (table stakes #10)
**Avoids:** WebKit CSS quirks (#11) — test in actual Tauri webview for all themes
**Research flag:** Standard pattern — no research needed.

### Phase Ordering Rationale

- Phases 1-3 form an unbreakable dependency chain: terminal -> layout -> tabs. Each phase requires the previous to be complete.
- Phase 4 (git) can partially overlap with Phases 2-3 at the Rust layer but sidebar UI requires Phase 3 to be functional.
- Phase 5 (agents) has hard dependencies on both Phase 1 (PTY child PIDs) and Phase 4 (branch/workspace model for context).
- Phase 6 (session) is deferred intentionally — the schema must be stable, and the full entity model (tabs, panes, branches) must be finalized first.
- Phase 7 (polish) is always last. Settings panels and themes need all features to exist before they can be comprehensive.
- The 5 critical pitfalls all hit in Phases 1-2. Solving them early prevents cascading rework.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4:** git2 worktree API edge cases — locked worktrees, detached HEAD worktrees, bare repo handling. Run against diverse real repos before committing to API design.
- **Phase 5:** Current AI agent process name patterns (claude, aider, codex, cursor-agent). Binary names may have changed since research. Light validation before building the known_agents list.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Tauri v2 + portable-pty + xterm.js pattern is well-documented. Canopy is a working reference implementation.
- **Phase 2:** Split pane binary tree pattern is documented by Warp. Established approach.
- **Phase 3:** Tab + PTY lifecycle management is standard Tauri state management. No surprises expected.
- **Phase 6:** JSON session persistence with tauri-plugin-store is standard. Schema validation is boilerplate.
- **Phase 7:** Settings panels and polish are project-specific. No domain research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technology choices verified against official docs and release notes. Version numbers confirmed current. Alternative analysis is thorough. |
| Features | HIGH | Competitive landscape well-researched with direct source links. Feature dependencies clearly mapped. Table stakes / differentiator distinction is well-reasoned. |
| Architecture | HIGH | Three-layer Tauri v2 pattern is the standard approach. Data flow patterns verified against official Tauri IPC docs. Reference implementations found. |
| Pitfalls | HIGH | Every pitfall links to specific GitHub issues or Tauri discussions confirming the problem exists. Mitigations are concrete. Phase warnings are specific. |

**Overall confidence:** HIGH

### Gaps to Address

- **git2 worktree edge cases:** The git2 crate docs warn of "likely lacking some bindings." The trait abstraction with CLI fallback must be built before committing to the git2 API surface. Validate against repos with locked worktrees, detached HEAD, and bare repos before Phase 4 implementation starts.
- **WebGL context limit on macOS WebKit:** The documented browser limit is 8-16 contexts, but the exact behavior on macOS Sequoia WebKit is not confirmed. The context budget system is the right mitigation regardless, but the exact threshold should be empirically tested during Phase 2.
- **Tauri v2 base64 IPC overhead:** The research notes ~33% overhead for base64-encoded PTY output. This is theoretically acceptable, but should be benchmarked under realistic multi-pane load (4 panes, each running a high-output process) before declaring Phase 1 complete.
- **Agent binary name patterns:** Known agent names (claude, aider, codex, cursor-agent) were identified but not confirmed against current release naming conventions. Verify against actual installed binaries before Phase 5.

## Sources

### Primary (HIGH confidence)
- [Tauri v2 Official Docs](https://v2.tauri.app/) — architecture, IPC, state management, capabilities, plugins
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js/) — v6.0 changes, specific issue threads for pitfalls
- [portable-pty crates.io](https://crates.io/crates/portable-pty) — PTY management API
- [git2 crates.io](https://crates.io/crates/git2) — worktree operations
- [sysinfo crates.io](https://crates.io/crates/sysinfo) — process inspection
- [React ARIA Components](https://react-aria.adobe.com/) — component library
- [Tailwind CSS v4](https://tailwindcss.com/) — styling
- [Vite 8 announcement](https://vite.dev/blog/announcing-vite8) — Rolldown bundler
- [Warp split pane blog post](https://dev.to/warpdotdev/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds-2kon) — split pane algorithm reference

### Secondary (MEDIUM confidence)
- [Canopy](https://github.com/The-Banana-Standard/canopy) — reference Tauri v2 terminal multiplexer implementation
- [TUICommander](https://github.com/sstraus/tuicommander) — reference Tauri v2 agent orchestrator
- [CMUX Terminal Guide](https://agmazon.com/blog/articles/technology/202603/cmux-terminal-ai-guide-en.html) — competitive analysis
- [Zellij vs Tmux Comparison](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/) — split pane UX patterns
- [Tauri IPC streaming discussions](https://github.com/tauri-apps/tauri/discussions/7146) — IPC bottleneck confirmation
- [Oxfmt beta announcement](https://oxc.rs/blog/2026-02-24-oxfmt-beta) — toolchain choice

### Tertiary (LOW confidence)
- [Best Terminal Emulators 2026 - DevToolReviews](https://www.devtoolreviews.com/reviews/best-terminal-emulators-2026) — competitive landscape
- [NTM Review](https://vibecoding.app/blog/ntm-review) — competitive analysis
- [Claude HUD](https://aitoolly.com/ai-news/article/2026-03-22-claude-hud-a-new-monitoring-plugin-for-claude-code-tracking-context-and-agent-activity) — agent monitoring context

---
*Research completed: 2026-03-31*
*Ready for roadmap: yes*
