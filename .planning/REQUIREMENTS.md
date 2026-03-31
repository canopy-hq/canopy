# Requirements: Superagent

**Defined:** 2026-03-31
**Core Value:** Developers can run and monitor multiple AI coding agents across workspaces from a single, fast native app with real terminals and git-native workflow support.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Terminal

- [ ] **TERM-01**: User can open a real shell session in a terminal pane (PTY + xterm.js WebGL)
- [ ] **TERM-02**: User can split panes horizontally (Cmd+D) and vertically (Cmd+Shift+D) with recursive nesting
- [ ] **TERM-03**: User can resize split panes by dragging visible splitter handles
- [ ] **TERM-04**: Each pane displays a floating header with CWD and agent status
- [ ] **TERM-05**: User can navigate between panes with Cmd+Option+arrow keys
- [ ] **TERM-06**: User can close the focused pane with Cmd+W
- [ ] **TERM-07**: Terminal renders 256-color, mouse events, and alternate screen buffer correctly

### Tabs

- [ ] **TABS-01**: User can open new tabs (Cmd+T), one tab per branch/worktree
- [ ] **TABS-02**: User can switch tabs with Cmd+1-9 and Cmd+Shift+[/]
- [ ] **TABS-03**: Active tab shows raised border and matching background
- [ ] **TABS-04**: Tab shows agent status dot (green pulse = working, amber = waiting)
- [ ] **TABS-05**: Waiting tab shows amber background tint + "input" pill badge

### Keyboard

- [ ] **KEYS-01**: iTerm2-compatible default shortcuts (split, navigate, tabs, copy/paste, clear, search)
- [ ] **KEYS-02**: KeybindingRegistry intercepts keydown, matched shortcuts preventDefault + execute action
- [ ] **KEYS-03**: Unmatched keys pass through to focused xterm.js terminal
- [ ] **KEYS-04**: User can override keybindings via ~/.superagent/keybindings.json

### Sidebar

- [ ] **SIDE-01**: Sidebar (230px default, resizable, toggle with Cmd+B) shows workspace list
- [ ] **SIDE-02**: Workspaces expand/collapse to show branches (⎇ blue) and worktrees (◆ purple) as children
- [ ] **SIDE-03**: Each item shows agent status dot (green pulsing = working, amber breathing = waiting, none = idle)
- [ ] **SIDE-04**: Collapsed repo shows agent summary dots + chevron
- [ ] **SIDE-05**: "Import Repository" button at bottom of sidebar
- [ ] **SIDE-06**: "+ new branch/worktree" button at bottom of expanded repo

### Git

- [ ] **GIT-01**: User can import a local git repository as a workspace
- [ ] **GIT-02**: User can list, create, and remove branches via git2 (no shell exec)
- [ ] **GIT-03**: User can create and remove worktrees via git2
- [ ] **GIT-04**: Create branch/worktree center modal with type cards (⎇ Branch vs ◆ Worktree), name input, base branch dropdown, worktree path auto-generated
- [ ] **GIT-05**: Modal shows git command preview at bottom before execution
- [ ] **GIT-06**: Sidebar shows branch ahead/behind status inline

### Agent

- [ ] **AGNT-01**: Agent detection polls every 2s per active PTY, inspecting child process tree via sysinfo
- [ ] **AGNT-02**: Detection matches process names against configurable known_agents list (claude, codex, aider, ...)
- [ ] **AGNT-03**: Agent status changes emit events to frontend (running, waiting, idle)
- [ ] **AGNT-04**: User can manually toggle agent indicator per PTY (Cmd+Shift+A)
- [ ] **AGNT-05**: Agent overview overlay (Cmd+Shift+O) shows all active agents across all workspaces with status, duration, workspace/branch
- [ ] **AGNT-06**: User can click an agent row in overlay to jump to that worktree/tab
- [ ] **AGNT-07**: Toast notifications appear when agent completes or needs input in a non-active worktree
- [ ] **AGNT-08**: Toast shows event type, workspace/branch, summary with "Jump"/"Dismiss" actions
- [ ] **AGNT-09**: Completion toasts auto-dismiss after 10s; waiting toasts persist
- [ ] **AGNT-10**: Pane gets subtle amber border glow + inset shadow when agent is waiting

### Theme

- [ ] **THME-01**: 8 built-in dark themes (Carbon, Graphite, Obsidian, Slate, Midnight, Void, Smoke, Ash)
- [ ] **THME-02**: Themes applied via CSS custom properties for instant switching
- [ ] **THME-03**: User selects theme in settings; stored in ~/.superagent/settings.json

### Settings

- [ ] **SETT-01**: Settings opens with Cmd+, replacing app UI; Esc/back arrow returns
- [ ] **SETT-02**: Git sub-tab: default shell dropdown, auto-fetch toggle + interval
- [ ] **SETT-03**: Worktrees sub-tab: default worktree location (path + folder picker), naming pattern, auto-cleanup toggle, imported worktrees list
- [ ] **SETT-04**: Settings persisted to ~/.superagent/settings.json
- [ ] **SETT-05**: Known agents list configurable in settings

### Session

- [ ] **SESS-01**: On close, save session state to ~/.superagent/session.json (open workspaces, tabs, pane layout tree, focused pane)
- [ ] **SESS-02**: On reopen, restore layout and re-spawn PTY sessions in same CWDs
- [ ] **SESS-03**: Terminal scroll history is NOT persisted (PTY sessions are ephemeral)

### Status Bar

- [ ] **STAT-01**: Status bar left: repo name, branch type icon (⎇/◆), branch name, pane count
- [ ] **STAT-02**: Status bar right: agent summary ("2 working", "1 waiting"), shortcut hints, Cmd+Shift+O hint

### App Shell

- [ ] **SHELL-01**: Tauri v2 app with Rust backend and React + TypeScript frontend
- [ ] **SHELL-02**: macOS menu bar: Superagent (About, Settings, Quit), Edit (Undo/Redo/Cut/Copy/Paste/Select All), Window (Minimize/Zoom/Close)
- [ ] **SHELL-03**: Error toast notifications (bottom-right, red accent, auto-dismiss 8s)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Customization

- **CUST-01**: Theme customization UI (color editor, import/export)
- **CUST-02**: Plugin/extension system for community features

### Cross-Platform

- **PLAT-01**: Linux support
- **PLAT-02**: Windows support

### Advanced Agent

- **AAGN-01**: Multi-agent orchestration dashboard
- **AAGN-02**: Token usage / cost tracking per agent session

### Integrations

- **INTG-01**: IDE deep-linking (VS Code, JetBrains)
- **INTG-02**: Built-in diff viewer
- **INTG-03**: Mixed content panes (browser, markdown preview)
- **INTG-04**: OAuth login / team collaboration features

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Built-in AI chat / command generation | Warp owns this space. Superagent manages agents, doesn't replace them. |
| Multi-agent orchestration | Enormous scope (agent lifecycle, error recovery, prompt routing). Let agent tools handle this. |
| Token/cost tracking | Analytics problem, not a terminal problem. Use Agent Watch or Datadog. |
| Remote/SSH management UI | Massive scope. Users can SSH from within the terminal. |
| Plugin/extension system | Premature. Nail core experience first. |
| Theme customization UI | 8 built-in themes sufficient. No runtime theme editor for v1. |
| Linux/Windows | macOS only for v1 to eliminate platform-specific bugs. |
| Team/collaborative features | Requires auth, accounts, backend service. Single-user desktop app. |
| Code signing | Run unsigned for dev. Signing deferred to distribution milestone. |
| Integration/E2E tests | Unit tests only for v1. Integration testing deferred. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TERM-01 | — | Pending |
| TERM-02 | — | Pending |
| TERM-03 | — | Pending |
| TERM-04 | — | Pending |
| TERM-05 | — | Pending |
| TERM-06 | — | Pending |
| TERM-07 | — | Pending |
| TABS-01 | — | Pending |
| TABS-02 | — | Pending |
| TABS-03 | — | Pending |
| TABS-04 | — | Pending |
| TABS-05 | — | Pending |
| KEYS-01 | — | Pending |
| KEYS-02 | — | Pending |
| KEYS-03 | — | Pending |
| KEYS-04 | — | Pending |
| SIDE-01 | — | Pending |
| SIDE-02 | — | Pending |
| SIDE-03 | — | Pending |
| SIDE-04 | — | Pending |
| SIDE-05 | — | Pending |
| SIDE-06 | — | Pending |
| GIT-01 | — | Pending |
| GIT-02 | — | Pending |
| GIT-03 | — | Pending |
| GIT-04 | — | Pending |
| GIT-05 | — | Pending |
| GIT-06 | — | Pending |
| AGNT-01 | — | Pending |
| AGNT-02 | — | Pending |
| AGNT-03 | — | Pending |
| AGNT-04 | — | Pending |
| AGNT-05 | — | Pending |
| AGNT-06 | — | Pending |
| AGNT-07 | — | Pending |
| AGNT-08 | — | Pending |
| AGNT-09 | — | Pending |
| AGNT-10 | — | Pending |
| THME-01 | — | Pending |
| THME-02 | — | Pending |
| THME-03 | — | Pending |
| SETT-01 | — | Pending |
| SETT-02 | — | Pending |
| SETT-03 | — | Pending |
| SETT-04 | — | Pending |
| SETT-05 | — | Pending |
| SESS-01 | — | Pending |
| SESS-02 | — | Pending |
| SESS-03 | — | Pending |
| STAT-01 | — | Pending |
| STAT-02 | — | Pending |
| SHELL-01 | — | Pending |
| SHELL-02 | — | Pending |
| SHELL-03 | — | Pending |

**Coverage:**
- v1 requirements: 52 total
- Mapped to phases: 0
- Unmapped: 52

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after initial definition*
