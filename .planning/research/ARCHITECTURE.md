# Architecture Patterns

**Domain:** Desktop terminal multiplexer with AI agent management
**Researched:** 2026-03-31

## Recommended Architecture

Superagent follows a three-layer architecture typical of Tauri v2 apps, with a clear separation between the Rust backend (system operations, PTY management, git operations), the IPC bridge (Tauri commands and events), and the React frontend (UI rendering, layout state, terminal display).

```
+---------------------------------------------------------------+
|                      React Frontend (WebView)                  |
|                                                                |
|  +-----------+  +------------+  +-----------+  +------------+ |
|  | Sidebar   |  | Tab Bar    |  | Split     |  | Overlays   | |
|  | (repos,   |  | (branches, |  | Pane Tree |  | (agent     | |
|  |  agents)  |  |  worktrees)|  | (layout)  |  |  overview,  | |
|  +-----------+  +------------+  +-----------+  |  modals)   | |
|                                  |             +------------+ |
|                          +-------v--------+                    |
|                          | xterm.js       |                    |
|                          | Instances      |                    |
|                          | (WebGL addon)  |                    |
|                          +-------+--------+                    |
+--------------------------|-------|---------+-------------------+
                     invoke|       |events
                    (cmds) |       |(streams)
+--------------------------|-------|---------+-------------------+
|                    Tauri IPC Bridge                             |
|              Commands (req/res) + Events (push)                |
+--------------------------|-------|---------+-------------------+
                           |       |
+--------------------------|-------|---------+-------------------+
|                      Rust Backend                              |
|                                                                |
|  +-----------+  +------------+  +-----------+  +------------+ |
|  | PTY       |  | Git        |  | Agent     |  | Session    | |
|  | Manager   |  | Service    |  | Detector  |  | Store      | |
|  | (portable |  | (git2)     |  | (sysinfo) |  | (serde +   | |
|  |  -pty)    |  |            |  |           |  |  fs/JSON)  | |
|  +-----------+  +------------+  +-----------+  +------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  | App State (Mutex<AppState>) managed by Tauri              | |
|  +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Layer |
|-----------|---------------|-------------------|-------|
| **PTY Manager** | Spawn/destroy shell processes, read/write to PTY file descriptors, resize terminals | Frontend xterm.js instances via Tauri events | Rust backend |
| **Git Service** | Branch listing, worktree create/delete/list, repo status, HEAD resolution | Frontend sidebar/tab bar via Tauri commands | Rust backend |
| **Agent Detector** | Poll process tree every 2s, match known agent names against PTY child processes | Frontend status indicators via Tauri events | Rust backend |
| **Session Store** | Persist layout tree, open tabs, focused pane, window geometry to disk | Loaded on startup, saved on changes | Rust backend |
| **App State** | Central Mutex-wrapped state: active PTYs, repo handles, agent statuses | All backend services read/write; frontend queries via commands | Rust backend |
| **Split Pane Tree** | Recursive binary tree of layout nodes, flex ratios, pane identity | xterm.js instances, layout calculations | React frontend |
| **Sidebar** | Workspace list, repo expand/collapse, branch/worktree entries, agent dots | Git Service (queries), Agent Detector (status), Tab Bar (selection) | React frontend |
| **Tab Bar** | One tab per branch/worktree, close/reorder, agent status badge | Split Pane Tree (which pane is focused), PTY Manager (associated shell) | React frontend |
| **xterm.js Instances** | Render terminal output, capture user input, fit to container | PTY Manager (bidirectional data), Split Pane Tree (dimensions) | React frontend |
| **Overlays** | Agent overview, create branch/worktree modal, settings, toast notifications | Various backend services via commands | React frontend |

### Data Flow

#### Terminal I/O (hot path, latency-critical)

```
User keystroke
  -> xterm.js term.onData(callback)
  -> Tauri event: "pty:write:{pty_id}" with input bytes
  -> PTY Manager writes to PTY fd
  -> Shell process produces output
  -> PTY Manager reads from PTY fd
  -> Tauri event: "pty:data:{pty_id}" with output bytes
  -> xterm.js terminal.write(data)
```

Use **Tauri events** (not commands) for terminal I/O. Events are fire-and-forget, avoiding the overhead of JSON-RPC request/response serialization on every keystroke. The PTY Manager spawns a tokio task per PTY that continuously reads from the PTY fd and emits events.

#### Git Operations (cold path, user-initiated)

```
User clicks "New Worktree" in modal
  -> React dispatches invoke("git_create_worktree", { repo, branch, path })
  -> Tauri command handler opens git2::Repository, creates worktree
  -> Returns Result<WorktreeInfo, GitError> as JSON
  -> React updates sidebar and opens new tab
```

Use **Tauri commands** (invoke) for git operations. They are request/response, type-safe via serde, and naturally async. Git2 Repository handles are NOT Send, so open a fresh Repository per command invocation (git2 opens are cheap -- just reads .git/HEAD).

#### Agent Detection (background, periodic)

```
Every 2 seconds (tokio::time::interval):
  Agent Detector reads process table via sysinfo
  -> For each active PTY, walks child process tree from shell PID
  -> Matches process names against known_agents list
  -> Diffs against previous state
  -> If changed: emit Tauri event "agent:status-changed" with { pty_id, status }
  -> Frontend updates sidebar dots, tab badges, pane glow
```

#### Session Persistence

```
On layout change (split, close, resize, tab switch):
  React serializes layout tree to JSON
  -> invoke("session_save", { layout, tabs, focused, window_geometry })
  -> Session Store writes to ~/.superagent/session.json (or app data dir)

On app launch:
  -> invoke("session_load") returns saved state
  -> React reconstructs layout tree, opens tabs, spawns PTYs
```

## Patterns to Follow

### Pattern 1: Split Pane Tree (Binary Tree with Flex Ratios)

**What:** Model the pane layout as a recursive tree where branch nodes define split direction and leaf nodes hold terminal instances. This is the pattern used by Warp, iTerm2, and tmux internally.

**When:** Any time panes need to be split, resized, closed, or serialized.

**Data Structure:**

```typescript
type SplitDirection = "horizontal" | "vertical";

interface BranchNode {
  type: "branch";
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  ratios: number[]; // sum to 1.0, one per child
}

interface LeafNode {
  type: "leaf";
  id: string;
  ptyId: string; // links to backend PTY
  tabId: string; // links to tab bar entry
}

type LayoutNode = BranchNode | LeafNode;

// Root is always a single LayoutNode
interface LayoutState {
  root: LayoutNode;
  focusedPaneId: string;
}
```

**Split algorithm:** DFS to find target leaf. If parent branch direction matches split direction, insert sibling and redistribute ratios. If direction differs, replace leaf with new branch containing original leaf + new leaf.

**Resize algorithm:** Adjust ratios of adjacent siblings in the same branch node. Ratios always sum to 1.0. Actual pixel sizes computed top-down from container dimensions.

### Pattern 2: PTY Lifecycle Management

**What:** Each PTY is an isolated resource with a unique ID, managed in a HashMap behind a Mutex in Rust state.

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use portable_pty::{CommandBuilder, PtySize, native_pty_system, MasterPty};

pub struct PtyInstance {
    pub id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub shell_pid: u32,
    pub cwd: PathBuf,
}

pub struct PtyManager {
    pub instances: Mutex<HashMap<String, PtyInstance>>,
}
```

**Lifecycle:** spawn (on tab open / pane split) -> read/write loop (tokio tasks) -> resize (on pane resize) -> kill (on tab close / pane close) -> cleanup from map.

### Pattern 3: Tauri State with Mutex

**What:** Use `tauri::Builder::default().manage(state)` with Mutex-wrapped structs. Access in commands via `State<'_, Mutex<T>>`.

**When:** Any shared mutable state across commands (PTY map, agent statuses, settings).

```rust
#[tauri::command]
async fn pty_spawn(
    state: tauri::State<'_, Mutex<PtyManager>>,
    cwd: String,
    shell: Option<String>,
) -> Result<String, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    // spawn PTY, insert into manager.instances, return pty_id
}
```

### Pattern 4: Event-Driven Terminal Data Transport

**What:** Use Tauri's event system for streaming PTY output to the frontend, not commands.

**Why:** Commands are request/response with JSON-RPC overhead. Terminal output is a continuous stream -- events are fire-and-forget with lower latency.

```rust
// Backend: emit PTY output
app_handle.emit(&format!("pty:data:{}", pty_id), &base64_data)?;

// Frontend: listen for PTY output
listen(`pty:data:${ptyId}`, (event) => {
  terminal.write(atob(event.payload));
});
```

**Note:** Binary data must be base64-encoded for Tauri events (JSON payloads only). This adds ~33% overhead but is unavoidable in current Tauri v2. For most terminal workloads this is negligible.

### Pattern 5: Git2 Repository-Per-Call

**What:** Open a fresh `git2::Repository` for each Tauri command invocation rather than holding a long-lived handle.

**Why:** git2::Repository is not Send/Sync. Opening is cheap (reads .git/HEAD, ~microseconds). Long-lived handles risk stale state if external git operations modify the repo.

```rust
#[tauri::command]
async fn git_list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    // use repo, return results, repo drops automatically
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing git2::Repository in Tauri State

**What:** Keeping a `Repository` handle alive in managed state across commands.
**Why bad:** Not Send/Sync, will cause compilation errors or require unsafe. Also risks stale state.
**Instead:** Open per-call. It is fast.

### Anti-Pattern 2: Using Commands for Terminal I/O

**What:** Using `invoke("pty_write", data)` and `invoke("pty_read")` for terminal data.
**Why bad:** JSON-RPC overhead per keystroke/output chunk. Commands are request/response -- terminal data is a stream.
**Instead:** Use Tauri events for PTY data transport.

### Anti-Pattern 3: Global Mutable State Without Mutex

**What:** Using `static mut` or `RefCell` for shared state in Tauri commands.
**Why bad:** Tauri commands run on a thread pool. Data races.
**Instead:** `Mutex<T>` managed via `tauri::Builder::manage()`.

### Anti-Pattern 4: Pixel-Based Pane Sizing

**What:** Storing absolute pixel dimensions for each pane.
**Why bad:** Every window resize requires recalculating all pane sizes. Breaks on different screen sizes.
**Instead:** Flex ratios (0.0-1.0) computed top-down from container. Only ratios are stored/serialized.

### Anti-Pattern 5: Polling Git Status on a Timer

**What:** Running `git status` every N seconds to update the sidebar.
**Why bad:** Expensive for large repos. Wastes CPU.
**Instead:** Update git info on user-initiated actions (tab switch, branch create, explicit refresh). Consider fs watcher on `.git/HEAD` and `.git/refs/` for passive updates.

## Suggested Build Order (Dependencies)

The architecture has clear dependency chains that dictate build order:

```
Phase 1: App Shell + Single Terminal
  Tauri v2 scaffold -> PTY Manager (spawn one shell) -> xterm.js rendering
  Dependencies: None. Foundation for everything.

Phase 2: Split Pane System
  Layout tree data structure -> recursive React renderer -> resize handles
  Dependencies: Phase 1 (needs working terminal to split)

Phase 3: Tab Bar + Multi-Terminal
  Tab state management -> tab <-> pane association -> PTY per tab
  Dependencies: Phase 1 (PTY), Phase 2 (panes)

Phase 4: Git Integration + Sidebar
  Git Service (git2) -> sidebar workspace list -> branch/worktree display
  Dependencies: Phase 1 (app shell). Can partially parallel with Phase 2-3.

Phase 5: Agent Detection
  sysinfo process polling -> PTY child tree walking -> status events
  Dependencies: Phase 1 (PTY Manager, need shell PIDs)

Phase 6: Session Persistence
  Serialize layout tree + tabs -> save/restore on launch
  Dependencies: Phase 2 (layout tree), Phase 3 (tabs)

Phase 7: Polish (themes, keybindings, settings, status bar, menus)
  Dependencies: All above must be stable
```

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Events for PTY data, Commands for everything else | Latency vs type-safety tradeoff. Terminal I/O needs low latency; git ops need structured responses. |
| Frontend owns layout tree, backend owns PTY map | Layout is a UI concern (React state). PTY lifecycle is a system concern (Rust). Connected by IDs. |
| git2 opened per-call, not cached | Simplicity, thread safety, freshness. Sub-microsecond open cost. |
| sysinfo for agent detection, not procfs directly | Cross-platform (future), safe API, handles macOS process iteration correctly. |
| JSON file for session persistence, not SQLite | Session data is a single document (layout tree + tabs). No relational queries needed. SQLite adds complexity without benefit here. |
| Base64 encoding for PTY event payloads | Tauri events only support JSON. Binary terminal data must be encoded. ~33% overhead is acceptable for terminal bandwidth. |

## Scalability Considerations

| Concern | At 5 terminals | At 20 terminals | At 50+ terminals |
|---------|----------------|-----------------|------------------|
| PTY read loops | 5 tokio tasks, negligible | 20 tasks, still fine | May need backpressure/batching |
| xterm.js WebGL | 5 canvases, GPU handles it | 20 canvases, watch VRAM | Virtualize off-screen terminals |
| Agent polling | 5 PIDs to walk, fast | 20 PIDs, still under 50ms | Batch process table reads (single sysinfo refresh, filter) |
| Layout tree depth | 3-4 levels, fast render | 6-8 levels, still fine | Unlikely to hit. Cap max depth at 10. |
| Git2 repo opens | Instant | Instant | Instant (it is just reading .git/HEAD) |

## Sources

- [Tauri v2 Architecture](https://v2.tauri.app/concept/architecture/) - Official architecture docs
- [Tauri v2 IPC](https://v2.tauri.app/concept/inter-process-communication/) - Commands vs Events
- [Tauri v2 State Management](https://v2.tauri.app/develop/state-management/) - Managed state patterns
- [Tauri v2 Calling Rust](https://v2.tauri.app/develop/calling-rust/) - Command patterns
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty) - PTY plugin for Tauri v2
- [Canopy](https://github.com/The-Banana-Standard/canopy) - Reference Tauri v2 terminal multiplexer
- [TUICommander](https://github.com/sstraus/tuicommander) - Reference Tauri v2 agent orchestrator
- [Warp: Tree Data Structures for Split Panes](https://dev.to/warpdotdev/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds-2kon) - Split pane algorithm
- [git2 Worktree API](https://docs.rs/git2/latest/git2/struct.Worktree.html) - Rust git2 worktree operations
- [sysinfo crate](https://docs.rs/sysinfo/latest/sysinfo/) - Process inspection for agent detection
- [xterm.js](https://xtermjs.org/) - Terminal rendering library
