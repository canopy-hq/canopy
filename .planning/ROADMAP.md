# Roadmap: Superagent

## Overview

Superagent delivers a native macOS desktop app for managing AI coding agents across git workspaces. The build follows a strict dependency chain: working terminal first, then layout (split panes), then multi-terminal management (tabs), then git workspace model (sidebar), then the killer differentiator (agent detection + status), and finally persistence and configuration. Each phase delivers a complete, verifiable capability that unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: App Shell + Single Terminal** - Tauri v2 scaffold with one working PTY terminal pane
- [ ] **Phase 2: Split Panes + Keyboard** - Recursive split pane system with navigation and resize
- [ ] **Phase 3: Tabs + Themes + Status Bar** - Tab management, dark themes, and status bar
- [ ] **Phase 4: Git Integration + Sidebar** - Git workspace model with sidebar navigation
- [ ] **Phase 5: Agent Detection + Status UI** - Process-based agent detection with status indicators everywhere
- [ ] **Phase 6: Session Persistence + Settings** - Layout persistence, settings panel, keybinding overrides

## Phase Details

### Phase 1: App Shell + Single Terminal
**Goal**: User can launch a native macOS app and use a real terminal with full shell capabilities
**Depends on**: Nothing (first phase)
**Requirements**: SHELL-01, SHELL-02, SHELL-03, TERM-01, TERM-07
**Success Criteria** (what must be TRUE):
  1. User can launch the app and see a single terminal pane with their default shell running
  2. Terminal renders 256-color output, handles mouse events, and displays alternate screen apps (vim, htop) correctly
  3. macOS menu bar shows standard menus (About, Settings, Quit, Edit, Window) with working shortcuts
  4. Error conditions display toast notifications in bottom-right corner
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Scaffold Tauri v2 project and wire PTY terminal (SHELL-01, TERM-01, TERM-07)
- [x] 01-02-PLAN.md — Add macOS menu bar and error toast system (SHELL-02, SHELL-03)

### Phase 2: Split Panes + Keyboard
**Goal**: User can create a multi-pane terminal workspace with keyboard-driven navigation
**Depends on**: Phase 1
**Requirements**: TERM-02, TERM-03, TERM-04, TERM-05, TERM-06, KEYS-01, KEYS-02, KEYS-03
**Success Criteria** (what must be TRUE):
  1. User can split panes horizontally (Cmd+D) and vertically (Cmd+Shift+D) with unlimited recursive nesting
  2. User can drag splitter handles to resize panes, and each pane shows a floating header with CWD
  3. User can navigate between panes with Cmd+Option+arrows and close focused pane with Cmd+W
  4. iTerm2-compatible shortcuts work; unmatched keys pass through to the focused terminal
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Pane tree data layer, keyboard registry, close_pty backend (TERM-02, TERM-03, TERM-05, TERM-06, KEYS-01, KEYS-02, KEYS-03)
- [x] 02-02-PLAN.md — Split pane UI components: recursive renderer, splitter, terminal pane, header (TERM-02, TERM-03, TERM-04)
- [x] 02-03-PLAN.md — Integration wiring: App.tsx orchestration, shortcuts, end-to-end verification (TERM-02, TERM-05, TERM-06, KEYS-01, KEYS-02, KEYS-03)

### Phase 3: Tabs + Themes + Status Bar
**Goal**: User can manage multiple terminal workspaces via tabs with visual theming
**Depends on**: Phase 2
**Requirements**: TABS-01, TABS-02, TABS-03, THME-01, THME-02, THME-03, STAT-01, STAT-02
**Success Criteria** (what must be TRUE):
  1. User can open new tabs (Cmd+T), switch between them (Cmd+1-9, Cmd+Shift+[/]), and each tab has its own pane layout
  2. Active tab is visually distinct with raised border and matching background
  3. User can switch between 8 dark themes and the change applies instantly across all UI
  4. Status bar shows current repo name, branch info, and pane count
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Git Integration + Sidebar
**Goal**: User can manage git repositories, branches, and worktrees from an integrated sidebar
**Depends on**: Phase 3
**Requirements**: GIT-01, GIT-02, GIT-03, GIT-04, GIT-05, GIT-06, SIDE-01, SIDE-02, SIDE-05, SIDE-06
**Success Criteria** (what must be TRUE):
  1. User can import a local git repo and see it in a collapsible sidebar with branches and worktrees listed
  2. User can create and remove branches and worktrees via a modal with type cards, name input, and git command preview
  3. Sidebar shows branch ahead/behind status and distinguishes branches (blue) from worktrees (purple)
  4. Sidebar is resizable, togglable with Cmd+B, and has buttons for importing repos and creating branches/worktrees
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Agent Detection + Status UI
**Goal**: User can see at a glance which AI agents are running, waiting, or idle across all workspaces
**Depends on**: Phase 4
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-06, AGNT-07, AGNT-08, AGNT-09, AGNT-10, TABS-04, TABS-05, SIDE-03, SIDE-04
**Success Criteria** (what must be TRUE):
  1. Agent processes (claude, codex, aider) are automatically detected in terminal panes with status shown as colored dots on panes, tabs, and sidebar items
  2. When an agent is waiting for input, the pane shows an amber border glow and the tab shows an amber tint with "input" badge
  3. Agent overview overlay (Cmd+Shift+O) lists all agents across workspaces with status and duration; clicking a row jumps to that workspace
  4. Toast notifications appear for agent events in non-active workspaces with "Jump" and "Dismiss" actions; waiting toasts persist, completion toasts auto-dismiss
  5. User can manually toggle agent indicator per pane (Cmd+Shift+A) and configure the known agents list
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Session Persistence + Settings
**Goal**: User's workspace survives app restarts and all preferences are configurable
**Depends on**: Phase 5
**Requirements**: SESS-01, SESS-02, SESS-03, SETT-01, SETT-02, SETT-03, SETT-04, SETT-05, KEYS-04
**Success Criteria** (what must be TRUE):
  1. Closing and reopening the app restores all tabs, pane layouts, and focused pane with PTY sessions re-spawned in same directories
  2. Settings panel (Cmd+,) provides configuration for default shell, auto-fetch, worktree locations, naming patterns, and known agents list
  3. User can override keybindings via ~/.superagent/keybindings.json and changes take effect without restart
  4. Terminal scroll history is explicitly not persisted (fresh PTY sessions on restore)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. App Shell + Single Terminal | 0/2 | Planning complete | - |
| 2. Split Panes + Keyboard | 0/3 | Planning complete | - |
| 3. Tabs + Themes + Status Bar | 0/0 | Not started | - |
| 4. Git Integration + Sidebar | 0/0 | Not started | - |
| 5. Agent Detection + Status UI | 0/0 | Not started | - |
| 6. Session Persistence + Settings | 0/0 | Not started | - |
