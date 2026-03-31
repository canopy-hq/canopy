# Superagent — Design Spec

Desktop application for managing AI coding agents across workspaces. Replaces Superset.sh with a performant, Tauri-based native app.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| App framework | Tauri v2 | ~600KB, native WebKit, Rust backend |
| Frontend | React + TypeScript | Mature ecosystem, best-in-class accessibility via React ARIA |
| Components | React ARIA (Adobe) | 40+ headless accessible primitives, WAI-ARIA compliant |
| Styling | Tailwind CSS | Utility CSS, dark theme via CSS custom properties |
| Package manager | Bun | Fast installs, native TS, fast dev runtime |
| Bundler | Vite | Tauri-recommended, HMR, fast builds |
| Linter | Oxlint | Rust-based, 50-100x faster than ESLint |
| Formatter | Oxfmt (TS) + Cargo fmt (Rust) | Rust-based, consistent formatting |
| Rust linter | Clippy | Standard Rust linter |
| Terminal renderer | xterm.js (WebGL addon) | Battle-tested, GPU-accelerated |
| PTY | portable-pty (Rust) | Native shell spawning via Tauri backend |
| Git | git2 (Rust) | Branch/worktree ops without shelling out |
| FS watching | notify (Rust) | Git state change detection |
| Process inspection | sysinfo (Rust) | Agent detection via process tree |
| Async runtime | tokio | PTY I/O, fs watching, event streaming |
| Serialization | serde + serde_json | IPC and config persistence |

## Architecture

Event-driven IPC. Rust backend owns all system operations (PTY, git, filesystem, process detection). React frontend handles rendering only. Communication via Tauri typed commands + event streaming.

```
┌─────────────────────────────────┐
│  React Frontend               │
│  xterm.js │ sidebar │ pane mgr  │
└──────────┬──────────────────────┘
           │ Tauri Commands + Events
┌──────────┴──────────────────────┐
│  Rust Backend                   │
│  PTY mgr │ git ops │ fs watch   │
│  process detect │ workspace mgr │
└─────────────────────────────────┘
```

## Project Structure

```
superagent/
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── main.rs            # App entry, Tauri setup
│   │   ├── commands/          # IPC command handlers
│   │   │   ├── pty.rs         # create/resize/write/kill PTY
│   │   │   ├── workspace.rs   # import repo, list, remove
│   │   │   ├── git.rs         # branches, worktrees, status
│   │   │   └── settings.rs    # app preferences CRUD
│   │   ├── pty/
│   │   │   ├── manager.rs     # session lifecycle, multiplexing
│   │   │   └── process_detect.rs  # agent running detection
│   │   ├── workspace/
│   │   │   ├── manager.rs     # repo registry, worktree ops
│   │   │   └── watcher.rs     # fs watcher for git state
│   │   └── state.rs           # shared app state (Tauri managed)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                       # React frontend
│   ├── App.tsx                # root layout
│   ├── components/
│   │   ├── sidebar/           # workspace list, repo tree
│   │   ├── terminal/          # xterm.js wrapper, PTY binding
│   │   ├── panes/             # split pane manager
│   │   ├── create-modal/      # branch/worktree creation modal
│   │   └── settings/          # settings modal
│   ├── hooks/
│   │   ├── use-workspace.ts   # workspace state + actions
│   │   ├── use-terminal.ts    # PTY sessions, agent status
│   │   └── use-settings.ts    # user preferences
│   ├── lib/
│   │   ├── tauri.ts           # typed Tauri command wrappers
│   │   └── keybindings.ts     # keyboard shortcut registry
│   └── styles/
│       └── tailwind.css
├── bun.lock
├── package.json
└── tailwind.config.ts
```

## UI Layout

4 zones:

1. **Sidebar** (230px default, resizable via drag, min 160px, max 400px, toggle with ⌘B)
   - Workspaces (git repos) as expandable items. Chevron ▶/▼ on the right to expand/collapse.
   - Collapsed: repo name + agent summary dots (green/amber tiny dots) + chevron.
   - Expanded: children listed with **icon prefix** to distinguish type:
     - `⎇` (blue, #60a5fa) = branch (lightweight git ref)
     - `◆` (purple, #a78bfa) = worktree (physical directory on disk)
   - Agent status dot on the right of each item:
     - Green pulsing ring = agent working
     - Amber breathing dot = agent waiting for input (item also gets subtle amber border glow)
     - No dot = idle
   - `+ new branch / worktree` button at bottom of expanded repo
   - `+ Import Repository` button at bottom of sidebar
2. **Tab bar** — one tab per branch/worktree of active repo.
   - Active tab: raised with border, background matches pane area.
   - Agent dot matches sidebar (green/amber) before tab name.
   - Waiting tab: amber background tint + "input" pill badge.
   - `+` button on the right for new branch/worktree.
3. **Pane area** — recursive split panes. Each leaf = xterm.js terminal with its own PTY.
   - **Floating header** per pane: shows CWD (monospace) + agent status (e.g. "Claude ● 2:34") on the right.
   - **Visible drag handle** on splitter bars (rounded pill shape, appears on hover).
   - When agent is waiting: pane gets subtle amber border glow + inset shadow.
4. **Status bar** — left: repo name, branch type icon (⎇/◆), branch name, pane count. Right: agent summary ("2 working", "1 waiting"), shortcut hints, `⌘⇧O overview`.

### Agent Overview Overlay (⌘⇧O)
- Modal overlay showing all active agents across ALL workspaces.
- Each agent row: workspace name + type icon + branch name, current action, duration, status pill.
- Click a row to jump to that worktree/tab.
- Esc to close.

### Toast Notifications
- When an agent completes or needs input in a non-active worktree, a toast slides in from bottom-right.
- Shows: event type (completed/waiting), workspace/branch, summary.
- Actions: "Jump" / "View" + "Dismiss".
- Auto-dismiss after 10s for completions, persist for waiting.

### Create Branch/Worktree (Center Modal)
- Triggered by `+ new` in sidebar. Opens centered modal over the app with backdrop scrim.
- Two type cards at top: ⎇ Branch ("Lightweight git ref, no disk space") vs ◆ Worktree ("Separate directory, parallel work"). Selected card gets highlight border.
- Fields: branch name (monospace input), "from" branch (dropdown with ⎇/◆ icons), worktree path (auto-generated from settings.worktree_base_path, with folder picker icon).
- Git command preview at bottom showing the exact command that will run.
- Create / Cancel buttons.
- Esc to dismiss.

## Pane Tree Model

Recursive binary tree. Each node is either:
- `Split { direction: horizontal | vertical, children: [PaneNode, PaneNode], ratio: f64 }`
- `Leaf { pty_id, focused: bool }`

Supports arbitrary nesting. Splitter bars are draggable to resize.

## IPC Commands

### PTY
- `pty_create(cwd, shell) → pty_id` — spawn shell in new PTY
- `pty_write(pty_id, data)` — send keystrokes to PTY
- `pty_resize(pty_id, cols, rows)` — update PTY dimensions
- `pty_kill(pty_id)` — terminate PTY session

### PTY Events (Rust → Frontend)
- `pty_output { pty_id, data }` — continuous terminal output stream

### Workspace
- `workspace_import(path) → Workspace` — register local repo
- `workspace_list() → Workspace[]` — all registered workspaces
- `workspace_remove(id)` — unregister workspace

### Git
- `git_branches(workspace_id) → Branch[]`
- `git_create_branch(workspace_id, name, from)`
- `git_worktree_create(workspace_id, branch, path)`
- `git_worktree_list(workspace_id) → Worktree[]`
- `git_worktree_remove(workspace_id, path)`

### Agent Detection
- `agent_status(pty_id) → AgentStatus`
- `agent_toggle_manual(pty_id, running)`
- Event: `agent_status_changed { pty_id, status }`

### Settings
- `settings_get() → Settings`
- `settings_update(partial) → Settings`
- Persisted to `~/.superagent/settings.json`

## Agent Detection

Polls every 2 seconds per active PTY:
1. `sysinfo` inspects child processes of PTY shell pid
2. Match process name against `known_agents` list (configurable: `["claude", "codex", "aider", ...]`)
3. Match → emit `agent_status_changed { running: true, agent: "claude" }`
4. No match → check manual override flag → emit accordingly
5. Frontend updates sidebar badge + tab pill

## Theming

8 built-in themes ship as catalog:
- Carbon, Graphite, Obsidian, Slate, Midnight, Void, Smoke, Ash
- User selects default theme on first launch
- Theme customization deferred to v2

Theme stored in settings. Applied via CSS custom properties for instant switching.

## Keyboard Shortcuts

### Defaults (iTerm2-compatible)

**Pane management:**
| Shortcut | Action |
|----------|--------|
| `⌘D` | Split horizontal |
| `⌘⇧D` | Split vertical |
| `⌘W` | Close focused pane |
| `⌘⌥←→↑↓` | Navigate panes |
| `⌘⌥⇧←→↑↓` | Resize pane |

**Tabs & navigation:**
| Shortcut | Action |
|----------|--------|
| `⌘T` | New tab |
| `⌘1-9` | Switch to tab N |
| `⌘⇧[` / `⌘⇧]` | Prev / next tab |
| `⌘B` | Toggle sidebar |
| `⌘,` | Settings |

**Terminal:**
| Shortcut | Action |
|----------|--------|
| `⌘C` | Copy (when selection) |
| `⌘V` | Paste |
| `⌘K` | Clear terminal |
| `⌘F` | Search in terminal |

**Agent:**
| Shortcut | Action |
|----------|--------|
| `⌘⇧A` | Toggle agent indicator |
| `⌘⇧O` | Agent overview overlay |

### Architecture
- `KeybindingRegistry` intercepts keydown events
- Matched → preventDefault + execute action
- No match → passthrough to focused xterm.js → PTY
- User overrides via `~/.superagent/keybindings.json` (wins on conflict)

## Settings

### UX
- `⌘,` opens settings. Replaces entire app UI (sidebar + terminal disappear).
- Left nav sidebar with section list. For v1: single section "Git & Worktrees" with ⎇◆ icons.
- Content area has sub-tabs: `⎇ Git` and `◆ Worktrees`. Active tab has underline indicator.
- `←` back arrow or `Esc` returns to the main app.
- Version shown at bottom of nav sidebar.

### Git sub-tab
- Default shell (dropdown: /bin/zsh, /bin/bash, etc.)
- Auto-fetch toggle + interval

### Worktrees sub-tab
- Default worktree location (path input + Browse button → native folder picker)
- Naming pattern (monospace input, variables: `{branch-name}`, `{repo-name}`)
- Auto-cleanup toggle (remove worktree dirs when branch merged)
- Imported Worktrees list (name, path, ✕ to remove, "+ Import existing worktree")

### Persistence
Stored in `~/.superagent/settings.json`:
- `default_shell` — shell binary path
- `worktree_base_path` — default location for new worktrees
- `worktree_naming_pattern` — directory naming template
- `auto_cleanup_worktrees` — boolean
- `auto_fetch` — boolean
- `auto_fetch_interval` — minutes
- `theme` — active theme name
- `keybindings` — user shortcut overrides
- `known_agents` — process names for auto-detection
- `imported_worktrees` — manually imported worktree paths

## Session Persistence

On close, save to `~/.superagent/session.json`:
- Open workspaces (expanded/collapsed state)
- Active tabs per workspace (which branches/worktrees are open)
- Active tab selection (which tab was focused)
- Pane layout tree (split directions, ratios)
- Focused pane

On reopen, restore everything. PTY sessions are re-spawned in the same CWDs. If an agent (e.g. Claude) was running, the user lands back in that terminal — the shell session is new but the context is preserved (same directory, same tab).

Terminal scroll history is NOT persisted (PTY sessions are ephemeral).

## macOS Menu Bar

Minimal for v1:
- **Superagent** menu: About, Settings (⌘,), Quit (⌘Q)
- Standard Edit menu: Undo, Redo, Cut, Copy, Paste, Select All (for terminal compat)
- Standard Window menu: Minimize, Zoom, Close (⌘W)

Configured via `src-tauri/tauri.conf.json` menu config.

## Error Handling

Toast notifications for errors, same system as agent toasts but styled as errors:
- Slides in from bottom-right
- Red accent border
- Shows: error type, message, affected workspace/branch
- Auto-dismiss after 8s, or click to dismiss
- Examples: git operation failed, worktree path doesn't exist, PTY spawn failed, import failed

## Testing

Unit tests only for v1. Integration/E2E deferred.

**Rust (Cargo test):**
- PTY manager: spawn, resize, kill lifecycle
- Process detection: matching known agents list
- Workspace manager: import, list, remove
- Git operations: branch/worktree CRUD
- Settings: serialize/deserialize, partial merge

**TypeScript (Vitest + React Testing Library):**
- Pane tree model: split, close, navigate, resize logic
- Keybinding registry: match/no-match, user overrides
- Component tests: sidebar tree, pane splitting, settings form

## Tooling & CLI

All commands via `bun run <name>` in package.json:

| Command | What it does |
|---------|-------------|
| `bun run dev` | Vite dev server + Rust compile + launch app (HMR) |
| `bun run build` | Production build → `.app` + `.dmg` in `src-tauri/target/release/bundle/macos/` |
| `bun run lint` | Oxlint (TS) + Cargo Clippy (Rust) |
| `bun run fmt` | Oxfmt (TS) + Cargo fmt (Rust) |
| `bun run fmt:check` | Check formatting without writing (CI) |
| `bun run typecheck` | `tsc --noEmit` (TS) + `cargo check` (Rust) |
| `bun run test` | Vitest (TS) + Cargo test (Rust) |
| `bun run ci` | fmt:check + lint + typecheck + test + build (full pipeline) |

Under the hood, `bunx tauri dev` and `bunx tauri build` orchestrate both Vite and Cargo automatically. The package.json scripts wrap these + add linting/formatting/testing for both stacks.

### Packaging
- Tauri builds macOS `.app` bundle and `.dmg` installer automatically
- App icon, bundle ID, version configured in `src-tauri/tauri.conf.json`
- Code signing deferred to v2 (run unsigned for dev)

## MVP Scope (v1)

**In:**
- Tauri v2 app shell (Rust + React)
- Sidebar: icon prefix (⎇ branch / ◆ worktree), expand/collapse repos, agent dots
- Real terminal via native PTY + xterm.js (WebGL)
- Split pane system (⌘D/⌘⇧D) with floating per-pane headers + visible drag handles
- Create branch/worktree center modal with type cards + git preview
- Agent running indicator (process detection + manual toggle)
- Agent waiting state: amber glow on pane/tab/sidebar, breathing animation
- Agent overview overlay (⌘⇧O) — all agents across all workspaces
- Toast notifications for cross-worktree agent events
- Settings: worktree location, shell, theme, keybindings, known agents
- 8 built-in themes, dark UI
- macOS only

**Out (future):**
- Theme customization UI
- Multi-agent orchestration dashboard
- Built-in diff viewer
- IDE deep-linking
- Mixed content panes (non-terminal)
- Linux / Windows support
