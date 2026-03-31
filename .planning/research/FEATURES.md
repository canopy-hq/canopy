# Feature Landscape

**Domain:** Desktop terminal emulator with AI agent management for multi-workspace development
**Researched:** 2026-03-31

## Table Stakes

Features users expect from a terminal-based workspace manager. Missing any of these and users will stick with iTerm2+tmux or switch to CMUX/Warp.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real terminal emulation (PTY + xterm.js) | Every competitor has real shell. Anything less is a toy. | High | xterm.js WebGL addon is the standard. Must handle 256-color, mouse events, alternate screen buffer. |
| Split panes (horizontal + vertical) | tmux/Zellij/iTerm2/Warp all have this. Baseline. | High | Recursive splits with drag-to-resize. Zellij-style isolated resizing (moving one divider doesn't cascade) is strongly preferred over tmux-style. |
| Tab management | Every terminal app has tabs. Users expect Cmd+T, Cmd+W, Cmd+1-9. | Medium | One tab per branch/worktree is the Superagent twist, but basic tab mechanics must feel native. |
| Session persistence | WezTerm, Windows Terminal, tmux-resurrect all restore layout on relaunch. Users expect it. | Medium | Save: pane layout, working directories, active tabs. Restore on app relaunch. Do NOT try to restore scrollback or running processes for v1. |
| Keyboard shortcuts (iTerm2-compatible) | macOS developers have muscle memory. Breaking it means they leave. | Medium | Cmd+D split right, Cmd+Shift+D split down, Cmd+[ / Cmd+] navigate panes, Cmd+T new tab. Allow user overrides. |
| Sidebar navigation (workspace/repo list) | GitKraken, VS Code, and every workspace tool has a tree sidebar. | Medium | Expand/collapse repos, show branches/worktrees per repo. |
| Dark theme | 100% of developer terminal apps ship dark. | Low | Ship 2-3 good dark themes, not 8 mediocre ones. One "night owl"-style, one "monokai"-style, one "catppuccin"-style. |
| macOS-native menus and window management | Tauri gives this nearly free, but it must be correct. | Low | About, Preferences (Cmd+,), Quit (Cmd+Q), standard Edit/Window menus. |
| Settings panel | Every app has preferences. | Medium | Shell selection, theme, keybindings, workspace paths. |
| Fast startup and low memory | Tauri's selling point. If the app takes 3s to launch or eats 500MB, users will notice. | Low | Tauri v2 naturally delivers ~600KB binary. Keep JS bundle small, lazy-load heavy components. |

## Differentiators

Features that make Superagent worth switching to. These are the reasons someone would leave iTerm2+tmux or Warp.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Agent detection + status indicators** | No existing terminal shows "Claude is thinking" / "Claude is waiting for input" inline. This is THE killer feature. Developers running 3-5 agents across branches currently have no idea which ones are stuck. | High | Process tree inspection (polling) to detect known agents. States: running, thinking, waiting-for-input, idle, error. Display as colored dot on pane border, tab, and sidebar. Amber glow for "waiting" is critical -- this is the #1 pain point from GitHub issues. |
| **Branch/worktree-centric workspace model** | Terminals think in "tabs". Developers running AI agents think in "branches". One tab = one branch/worktree with its own terminal is a mental model shift that matches how people actually work with coding agents. | Medium | Each branch/worktree gets a tab. Creating a new branch/worktree creates a new tab with a terminal pre-cd'd to the worktree path. Icons distinguish branches (fork icon) from worktrees (diamond). |
| **Agent overview overlay** | Agent Watch and Vibe Cockpit exist as separate web dashboards. Having this built into the terminal itself (Cmd+Shift+A to see all agents across all workspaces) is a unique integration. | Medium | Grid/list of all detected agents, their status, which repo/branch they're in, how long they've been running. Click to jump to that pane. |
| **Cross-workspace agent notifications** | When Claude finishes in branch-X while you're looking at branch-Y, you need to know. Toast notifications + ambient status in sidebar/tab solve the "is it done yet?" polling behavior. | Medium | Toast notification with repo/branch context. Sidebar dot changes from amber (thinking) to green (done) or red (error). System notification for background/minimized app. |
| **Create branch/worktree modal** | No terminal has a built-in "create worktree" flow. Users currently shell out to `git worktree add`. A modal with type cards (feature branch, bugfix, experiment) and git command preview reduces friction for the parallel-agent workflow. | Medium | Modal with branch name input, base branch selector, worktree type cards. Shows exact git command that will run. One click creates worktree + opens new tab. |
| **Git-native sidebar metadata** | Showing branch status (ahead/behind), agent status dots, and worktree type inline in the sidebar is information density that no terminal or git GUI currently combines. | Medium | Uses git2 crate for real-time branch status. Combines git state + agent state in one glanceable view. |
| **Agent-aware status bar** | A status bar showing "3 agents running, 1 waiting for input" across all workspaces is instant situational awareness. CMUX has vertical tab metadata but not an aggregate status bar. | Low | Bottom bar: current repo, branch, agent count by status, keyboard shortcut hints. |

## Anti-Features

Features to explicitly NOT build. Each one is tempting but wrong for v1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Built-in AI chat / command generation | Warp owns this space with deep model integration and team workflows. Competing here is losing. Superagent's value is MANAGING agents, not BEING an agent. | Let the AI agents (Claude Code, Codex, Aider) run in the terminal. Superagent monitors them, doesn't replace them. |
| Multi-agent orchestration / task assignment | Overstory, NTM, and Claude Code's own --teammates mode handle orchestration. Building orchestration means owning agent lifecycle, error recovery, prompt routing -- enormous scope. | Detect and display agent status. Let users orchestrate via their agent tool of choice. |
| Token usage / cost tracking | Agent Watch and Datadog already track costs. This is an analytics problem, not a terminal problem. | Show agent status (running/waiting/idle). Leave cost tracking to dedicated tools. |
| Built-in diff viewer | VS Code, GitKraken, and `delta` do diffs better than we ever will. | Users can run `git diff` in the terminal or open their preferred diff tool. |
| Remote / SSH terminal management | Massive scope (SSH key management, tunneling, port forwarding). Not the core use case. | Users can SSH from within the terminal. No special remote management UI. |
| Plugin / extension system | Premature. Need to nail the core experience first. Plugin APIs are expensive to design and maintain. | Ship opinionated features. Revisit extensibility in v2 when usage patterns are clear. |
| Mixed content panes (browser, editor, markdown preview) | CMUX embeds a browser. This is scope creep for v1. Terminal panes only. | Every pane is a terminal. Keep it simple. |
| Theme customization UI / theme marketplace | 8 built-in themes is more than enough. Theme editors are a time sink for marginal value. | Ship good defaults. Accept PRs for new themes. No runtime theme editor. |
| Linux/Windows support | Tauri supports cross-platform but scoping to macOS first eliminates an entire class of platform-specific bugs (PTY behavior, window management, menu integration). | macOS only for v1. Cross-platform in v2 once core is validated. |
| Collaborative / team features | Warp has shared drives, session sharing, team workflows. This requires auth, accounts, a backend service. | Single-user desktop app. No accounts, no cloud, no team features for v1. |

## Feature Dependencies

```
Real terminal (PTY + xterm.js)
  --> Split panes (need terminal instances to split)
    --> Tab management (tabs contain pane layouts)
      --> Session persistence (persist tab/pane state)

Sidebar navigation
  --> Git integration (git2 for branch/worktree data)
    --> Branch/worktree-centric tabs (sidebar drives tab creation)
      --> Create branch/worktree modal (UI for new worktree flow)

Agent detection (process tree polling)
  --> Agent status indicators (need detection to show status)
    --> Agent overview overlay (aggregate all detected agents)
    --> Cross-workspace notifications (trigger on status change)
    --> Agent-aware status bar (summarize agent states)

Settings panel (standalone, no dependencies)
Dark themes (standalone, CSS custom properties)
Keyboard shortcuts (standalone, but test with split panes)
```

## MVP Recommendation

**Phase 1 -- Terminal foundation (must work perfectly before anything else):**
1. Real terminal emulation with PTY + xterm.js WebGL
2. Split panes (horizontal + vertical, recursive)
3. Tab management
4. Keyboard shortcuts (iTerm2-compatible)
5. Dark theme (ship 2-3)
6. macOS menus

**Phase 2 -- Git-native workspace model (the conceptual differentiator):**
1. Sidebar with workspace/repo list
2. Git integration via git2 (branches, worktrees)
3. Branch/worktree-centric tabs
4. Create branch/worktree modal
5. Settings panel

**Phase 3 -- Agent awareness (the killer feature):**
1. Agent detection via process polling
2. Agent status indicators (pane, tab, sidebar dots)
3. Cross-workspace notifications (toasts + sidebar updates)
4. Agent overview overlay
5. Agent-aware status bar
6. Session persistence

**Rationale for ordering:**
- Terminal must be rock-solid before adding workspace features (broken terminals = instant uninstall)
- Git workspace model must exist before agent features make sense (agents run in branches)
- Agent features are the differentiator but depend on both terminal and workspace foundations
- Session persistence deferred to Phase 3 because it needs the full tab/pane/workspace model to be stable

**Defer to post-v1:**
- Plugin system: Need usage data first
- Cross-platform: Validate on macOS first
- Team/collab features: Requires backend infrastructure
- Token/cost tracking: Let dedicated tools handle it

## Competitive Landscape Summary

| Competitor | Overlap with Superagent | Gap Superagent Fills |
|------------|------------------------|---------------------|
| **iTerm2 + tmux** | Terminal, splits, tabs, session persistence | No agent awareness, no git-native workspace model |
| **Warp** | Modern terminal, AI features, blocks | Warp IS the agent. Superagent MANAGES agents. Different value prop entirely. |
| **CMUX** | Agent-centric terminal, split panes, git metadata in tabs | CMUX focuses on agent automation (socket API for agents to control terminal). Superagent focuses on human monitoring/management of agents. |
| **Ghostty** | Fast GPU-rendered terminal | Pure terminal, no workspace or agent features |
| **Agent Watch / Vibe Cockpit** | Agent status monitoring, notifications | Web dashboards, not terminals. No split panes, no git integration. |
| **NTM (Named Tmux Manager)** | Multi-agent status dashboard in terminal | tmux wrapper, not a native app. TUI, not GUI. |

**Superagent's unique position:** The only native desktop app that combines real terminal emulation + git worktree-centric workspace management + built-in agent status monitoring. CMUX is the closest competitor but targets agent-as-driver (agents control the terminal). Superagent targets human-as-driver (human monitors agents across workspaces).

## Sources

- [Warp All Features](https://www.warp.dev/all-features)
- [Agent Watch](https://agent-watch.com/)
- [Vibe Cockpit](https://github.com/Dicklesworthstone/vibe_cockpit)
- [CMUX Terminal Guide](https://agmazon.com/blog/articles/technology/202603/cmux-terminal-ai-guide-en.html)
- [NTM Review](https://vibecoding.app/blog/ntm-review)
- [Best Terminal Emulators 2026 - DevToolReviews](https://www.devtoolreviews.com/reviews/best-terminal-emulators-2026)
- [Best Terminal Emulators 2026 - Scopir](https://scopir.com/posts/best-terminal-emulators-developers-2026/)
- [Zellij vs Tmux Comparison](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/)
- [WezTerm Workspaces](https://wezterm.org/recipes/workspaces.html)
- [GitKraken Worktrees](https://help.gitkraken.com/gitkraken-desktop/worktrees/)
- [Claude Code Agent Teams - tmux issue](https://github.com/anthropics/claude-code/issues/23615)
- [Claude Code Agent Teams - Zellij support](https://github.com/anthropics/claude-code/issues/24122)
- [agent-tmux-monitor](https://github.com/damelLP/agent-tmux-monitor)
- [Claude HUD](https://aitoolly.com/ai-news/article/2026-03-22-claude-hud-a-new-monitoring-plugin-for-claude-code-tracking-context-and-agent-activity)
