# Phase 4: Git Integration + Sidebar - Research

**Researched:** 2026-04-01
**Domain:** git2 Rust crate, React ARIA Tree/Dialog, Tauri IPC, sidebar layout
**Confidence:** HIGH

## Summary

Phase 4 adds a git-powered sidebar and branch/worktree management. The Rust backend will use the `git2` crate (0.20.4) for all git operations -- branch CRUD, worktree CRUD, ahead/behind counts. The frontend will use React ARIA's `Tree` component for the collapsible workspace hierarchy and `Dialog`/`Modal` for the create branch/worktree flow. A new `tauri-plugin-dialog` provides the native folder picker for repository import.

The git2 API is mature and covers all our needs: `Repository::branches()`, `Repository::branch()`, `Branch::delete()`, `Repository::worktree()` (creates), `Worktree::prune()` (removes), and `Repository::graph_ahead_behind()` for ahead/behind. The sidebar layout is a standard resizable panel pattern -- no library needed, just a CSS resize + Zustand state.

**Primary recommendation:** Build a `git.rs` Rust module exposing 6-8 Tauri commands (import_repo, list_branches, create_branch, delete_branch, create_worktree, remove_worktree, get_ahead_behind). Frontend sidebar is a new Zustand store (`workspace-store`) driving a React ARIA Tree, with a modal dialog for creation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GIT-01 | Import a local git repository as a workspace | `Repository::open()` + `tauri-plugin-dialog` folder picker |
| GIT-02 | List, create, remove branches via git2 | `Repository::branches()`, `Repository::branch()`, `Branch::delete()` |
| GIT-03 | Create and remove worktrees via git2 | `Repository::worktree()` (add), `Worktree::prune()` (remove) |
| GIT-04 | Create branch/worktree modal with type cards, name input, base branch dropdown, path auto-gen | React ARIA `Dialog`/`Modal` + form components |
| GIT-05 | Modal shows git command preview before execution | Pure frontend string interpolation from form state |
| GIT-06 | Sidebar shows branch ahead/behind status inline | `Repository::graph_ahead_behind(local_oid, upstream_oid)` |
| SIDE-01 | Sidebar 230px default, resizable, toggle Cmd+B | CSS flex + Zustand sidebar state + keyboard binding |
| SIDE-02 | Workspaces expand/collapse, branches blue, worktrees purple | React ARIA `Tree`/`TreeItem` with color-coded icons |
| SIDE-05 | "Import Repository" button at bottom of sidebar | Button triggering `tauri-plugin-dialog` `open({directory: true})` |
| SIDE-06 | "+ new branch/worktree" button at bottom of expanded repo | Button triggering the create modal (GIT-04) |
</phase_requirements>

## Standard Stack

### Core (New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| git2 (Rust) | 0.20.4 | All git operations | Rust-native libgit2 bindings. Thread-safe. Full branch/worktree/graph API. Already in project spec. |
| tauri-plugin-dialog (Rust) | 2.4+ | Native folder picker for repo import | Official Tauri plugin. `open({directory: true})` for folder selection. |
| @tauri-apps/plugin-dialog (JS) | 2.4+ | Frontend API for dialog plugin | JS bindings for the Rust dialog plugin. |

### Already Installed (No Changes)

| Library | Version | Purpose |
|---------|---------|---------|
| react-aria-components | 1.16.0 | Tree, Dialog, Modal, Button, Form components |
| zustand + immer | 5.x / 11.x | Workspace store (same pattern as tabs-store) |
| @tauri-apps/api | 2.10.1 | IPC invoke calls to Rust backend |
| tailwindcss | 4.2.2 | Sidebar styling, color-coded icons |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| git2 | Command::new("git") | Shell exec is slower, no type safety, error-prone parsing -- project explicitly chose git2 |
| tauri-plugin-dialog | HTML input[type=file] | No folder picker capability in web input; Tauri plugin gives native OS dialog |
| Custom tree component | React ARIA Tree | RAC Tree handles keyboard nav, a11y, expand/collapse out of the box |
| Resizable panel library | CSS flex + mouse drag | Simple enough to hand-roll; no external dep needed for a single sidebar |

### Installation

**Rust (src-tauri/Cargo.toml):**
```toml
git2 = "0.20"
tauri-plugin-dialog = "2"
```

**Frontend:**
```bash
bun add @tauri-apps/plugin-dialog
```

**Tauri capability (src-tauri/capabilities/default.json):**
```json
"dialog:default"
```

**Tauri plugin registration (lib.rs):**
```rust
.plugin(tauri_plugin_dialog::init())
```

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/src/
  git.rs              # NEW: All git2 Tauri commands
  lib.rs              # Updated: register git commands + dialog plugin
  pty.rs              # Existing (unchanged)

src/
  components/
    Sidebar.tsx        # NEW: Sidebar container (resizable, togglable)
    WorkspaceTree.tsx  # NEW: React ARIA Tree for repo/branch/worktree list
    CreateModal.tsx    # NEW: Branch/worktree creation dialog
  stores/
    workspace-store.ts # NEW: Zustand store for repos, branches, worktrees
  lib/
    git.ts             # NEW: IPC wrappers for git Tauri commands
```

### Pattern 1: Git Tauri Command Module

**What:** Single `git.rs` module with all git2 commands, similar to existing `pty.rs` pattern.
**When to use:** All git operations go through Tauri IPC commands.

```rust
// Source: existing pty.rs pattern + git2 docs
use git2::{Repository, BranchType, WorktreeAddOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub ahead: usize,
    pub behind: usize,
    pub branch_type: String, // "local" | "remote"
}

#[derive(Serialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branches: Vec<BranchInfo>,
    pub worktrees: Vec<WorktreeInfo>,
}

// State: Map of repo path -> cached Repository (not stored -- opened on demand)
// git2::Repository is NOT Send, so we can't store it in Tauri state directly.
// Instead, open the repo fresh for each command, or use a per-thread cache.

#[tauri::command]
pub fn import_repo(path: String) -> Result<RepoInfo, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    // ... enumerate branches, worktrees, build RepoInfo
    Ok(repo_info)
}
```

### Pattern 2: Workspace Zustand Store

**What:** Frontend store managing imported repos, their branches/worktrees, sidebar visibility.
**When to use:** All sidebar state.

```typescript
// Source: existing tabs-store.ts pattern
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface Branch {
  name: string;
  isHead: boolean;
  ahead: number;
  behind: number;
}

interface WorktreeEntry {
  name: string;
  path: string;
}

interface Workspace {
  id: string;
  path: string;
  name: string;
  branches: Branch[];
  worktrees: WorktreeEntry[];
  expanded: boolean;
}

interface WorkspaceState {
  workspaces: Workspace[];
  sidebarVisible: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  importRepo: (path: string) => Promise<void>;
  refreshRepo: (id: string) => Promise<void>;
  removeRepo: (id: string) => void;
  toggleExpanded: (id: string) => void;
}
```

### Pattern 3: React ARIA Tree for Sidebar

**What:** Use RAC `Tree` and `TreeItem` for workspace/branch/worktree hierarchy.

```tsx
import { Tree, TreeItem, TreeItemContent } from 'react-aria-components';

// Each workspace = expandable TreeItem
// Children = branches (blue icon) + worktrees (purple icon)
<Tree aria-label="Workspaces" selectionMode="single">
  {workspaces.map(ws => (
    <TreeItem key={ws.id} id={ws.id} textValue={ws.name}>
      <TreeItemContent>{ws.name}</TreeItemContent>
      {ws.branches.map(b => (
        <TreeItem key={b.name} id={`${ws.id}-branch-${b.name}`} textValue={b.name}>
          <TreeItemContent>
            <span className="text-blue-400">&#x2387;</span> {b.name}
            {b.ahead > 0 || b.behind > 0 ? (
              <span className="text-text-muted ml-auto">
                {b.ahead > 0 && `+${b.ahead}`}{b.behind > 0 && `-${b.behind}`}
              </span>
            ) : null}
          </TreeItemContent>
        </TreeItem>
      ))}
      {ws.worktrees.map(wt => (
        <TreeItem key={wt.name} id={`${ws.id}-wt-${wt.name}`} textValue={wt.name}>
          <TreeItemContent>
            <span className="text-purple-400">&#x25C6;</span> {wt.name}
          </TreeItemContent>
        </TreeItem>
      ))}
    </TreeItem>
  ))}
</Tree>
```

### Pattern 4: Create Branch/Worktree Modal

**What:** Center modal with type cards, form inputs, git command preview.

```tsx
import { DialogTrigger, Modal, ModalOverlay, Dialog, Heading } from 'react-aria-components';

<DialogTrigger>
  <Button>+ New</Button>
  <ModalOverlay className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <Modal className="bg-bg-secondary rounded-lg p-6 w-[480px] border border-border">
      <Dialog>
        <Heading slot="title">Create Branch or Worktree</Heading>
        {/* Type cards: Branch vs Worktree */}
        {/* Name input */}
        {/* Base branch dropdown */}
        {/* Worktree path (auto-generated, shown only for worktree type) */}
        {/* Git command preview at bottom */}
        <div className="mt-4 p-3 bg-bg-primary rounded font-mono text-xs text-text-muted">
          git {type === 'branch' ? `branch ${name} ${baseBranch}` : `worktree add ${path} -b ${name}`}
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>
</DialogTrigger>
```

### Anti-Patterns to Avoid

- **Storing git2::Repository in Tauri state:** `Repository` is NOT `Send`. Open fresh per command, or use `Mutex<Option<PathBuf>>` and reopen.
- **Shelling out to git:** Project explicitly chose git2 crate. No `Command::new("git")`.
- **Polling git status on timer from frontend:** Refresh on user actions (import, create, delete) only. No background polling for Phase 4.
- **Caching stale branch data:** Always re-read from git2 on explicit refresh. Don't serve stale branch lists.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tree view with expand/collapse + keyboard nav | Custom tree DOM | React ARIA `Tree` component | Handles a11y, keyboard nav, focus management |
| Modal dialog with backdrop + dismiss | Custom overlay + click handlers | React ARIA `Dialog`/`Modal`/`ModalOverlay` | Focus trapping, Esc dismiss, screen reader support |
| Native folder picker | Custom path input | `tauri-plugin-dialog` `open({directory: true})` | Native OS dialog, handles permissions, returns proper path |
| Ahead/behind calculation | Walk commit graph manually | `Repository::graph_ahead_behind()` | Already solved by libgit2, handles all edge cases |
| Branch name validation | Custom regex | `Branch::name_is_valid()` | Matches git's own rules exactly |

## Common Pitfalls

### Pitfall 1: git2::Repository is not Send

**What goes wrong:** Trying to store `Repository` in `Mutex<Repository>` as Tauri managed state fails to compile because `Repository` is `!Send`.
**Why it happens:** libgit2 handles are thread-local.
**How to avoid:** Store repo paths (not Repository instances) in state. Open `Repository::open(path)` at the start of each command. Opening is cheap (microseconds).
**Warning signs:** Compiler error about `Send` trait not implemented.

### Pitfall 2: Ahead/behind requires upstream tracking

**What goes wrong:** `graph_ahead_behind` needs two Oid values (local commit, upstream commit). If a branch has no upstream configured, calling `branch.upstream()` returns an error.
**Why it happens:** Not all branches track a remote.
**How to avoid:** Wrap `branch.upstream()` in a match. If Err, report ahead=0, behind=0 (or "no tracking").
**Warning signs:** Panics or errors on newly created local-only branches.

### Pitfall 3: Worktree path must not exist

**What goes wrong:** `Repository::worktree(name, path, opts)` fails if the target path already exists as a non-empty directory.
**Why it happens:** libgit2 expects to create the directory itself.
**How to avoid:** Validate path doesn't exist before calling. Auto-generate paths like `~/.superagent/worktrees/{repo}-{branch}`.
**Warning signs:** "directory already exists" error from git2.

### Pitfall 4: Locked worktrees can't be pruned

**What goes wrong:** `Worktree::prune()` fails silently or errors on locked worktrees.
**Why it happens:** Worktrees can be locked to prevent accidental deletion.
**How to avoid:** Check `is_locked()` before prune. If locked, either unlock first or show error to user.
**Warning signs:** Remove button appears to do nothing.

### Pitfall 5: Deleting the current HEAD branch

**What goes wrong:** `Branch::delete()` fails if the branch is currently checked out (is_head = true).
**Why it happens:** git doesn't allow deleting the checked-out branch.
**How to avoid:** Check `is_head()` before delete. Show error or switch to another branch first.
**Warning signs:** "Cannot delete branch which is currently checked out" error.

### Pitfall 6: Sidebar resize vs terminal resize conflict

**What goes wrong:** Dragging the sidebar handle triggers terminal container resize, which causes xterm fit addon to fire. If both happen on same frame, layout thrashes.
**Why it happens:** Both sidebar and terminal panes listen to container size changes via ResizeObserver.
**How to avoid:** Debounce sidebar resize the same way splitter drag is debounced (existing `useSplitterDrag` pattern). Consider `requestAnimationFrame` batching.
**Warning signs:** Terminal flickers or scrollbar jumps during sidebar resize.

### Pitfall 7: Tauri dialog plugin permissions

**What goes wrong:** Dialog `open()` throws error because plugin isn't registered or capability not declared.
**Why it happens:** Tauri v2 requires explicit plugin registration + capability grant.
**How to avoid:** Add both: `tauri_plugin_dialog::init()` in lib.rs AND `"dialog:default"` in capabilities/default.json.
**Warning signs:** "plugin not found" or permission error at runtime.

## Code Examples

### Opening a repo and listing branches with ahead/behind

```rust
// Source: git2 0.20.4 docs - Repository, Branch, graph_ahead_behind
use git2::{Repository, BranchType};

fn list_branches_with_status(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut branches = Vec::new();

    for branch_result in repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)")
            .to_string();
        let is_head = branch.is_head();

        let (ahead, behind) = match branch.upstream() {
            Ok(upstream) => {
                let local_oid = branch.get().target().unwrap();
                let upstream_oid = upstream.get().target().unwrap();
                repo.graph_ahead_behind(local_oid, upstream_oid)
                    .unwrap_or((0, 0))
            }
            Err(_) => (0, 0), // No upstream tracking
        };

        branches.push(BranchInfo {
            name,
            is_head,
            ahead,
            behind,
            branch_type: "local".to_string(),
        });
    }

    Ok(branches)
}
```

### Creating a worktree from a branch reference

```rust
// Source: git2-rs test suite (worktree.rs)
use git2::{Repository, WorktreeAddOptions};
use std::path::Path;

fn create_worktree(
    repo_path: &str,
    name: &str,
    wt_path: &str,
    base_branch: Option<&str>,
) -> Result<WorktreeInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut opts = WorktreeAddOptions::new();

    if let Some(branch_name) = base_branch {
        let branch = repo.find_branch(branch_name, git2::BranchType::Local)
            .map_err(|e| e.to_string())?;
        let reference = branch.into_reference();
        opts.reference(Some(&reference));
    }

    let wt = repo.worktree(name, Path::new(wt_path), Some(&opts))
        .map_err(|e| e.to_string())?;

    Ok(WorktreeInfo {
        name: wt.name().unwrap_or("").to_string(),
        path: wt.path().to_string_lossy().to_string(),
    })
}
```

### Listing worktrees

```rust
// Source: git2 0.20.4 docs - Repository::worktrees(), find_worktree()
fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut worktrees = Vec::new();

    for name in wt_names.iter() {
        let name = name.ok_or("invalid worktree name")?;
        match repo.find_worktree(name) {
            Ok(wt) => {
                if wt.validate().is_ok() {
                    worktrees.push(WorktreeInfo {
                        name: name.to_string(),
                        path: wt.path().to_string_lossy().to_string(),
                    });
                }
            }
            Err(_) => continue, // Skip invalid worktrees
        }
    }

    Ok(worktrees)
}
```

### Creating a branch

```rust
// Source: git2 0.20.4 docs - Repository::branch()
fn create_branch(repo_path: &str, name: &str, base: &str) -> Result<BranchInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    // Resolve base branch to commit
    let base_branch = repo.find_branch(base, git2::BranchType::Local)
        .map_err(|e| e.to_string())?;
    let commit = base_branch.get().peel_to_commit()
        .map_err(|e| e.to_string())?;

    let branch = repo.branch(name, &commit, false)
        .map_err(|e| e.to_string())?;

    Ok(BranchInfo {
        name: name.to_string(),
        is_head: branch.is_head(),
        ahead: 0,
        behind: 0,
        branch_type: "local".to_string(),
    })
}
```

### Frontend: Import repo via dialog

```typescript
// Source: tauri-plugin-dialog docs
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

async function importRepository(): Promise<RepoInfo | null> {
  const path = await open({
    directory: true,
    multiple: false,
    title: 'Select Git Repository',
  });
  if (!path) return null; // User cancelled

  return invoke<RepoInfo>('import_repo', { path });
}
```

### Sidebar resize pattern

```tsx
// Sidebar with drag-to-resize (follows existing useSplitterDrag pattern)
function Sidebar({ children }: { children: React.ReactNode }) {
  const visible = useWorkspaceStore(s => s.sidebarVisible);
  const width = useWorkspaceStore(s => s.sidebarWidth);
  const setWidth = useWorkspaceStore(s => s.setSidebarWidth);

  // Drag handle on right edge
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      setWidth(Math.max(180, Math.min(400, startWidth + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, setWidth]);

  if (!visible) return null;

  return (
    <div className="flex-shrink-0 border-r border-border bg-bg-secondary flex" style={{ width }}>
      <div className="flex-1 overflow-y-auto">{children}</div>
      <div className="w-1 cursor-col-resize hover:bg-accent" onMouseDown={handleMouseDown} />
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| git2 0.19.x | git2 0.20.4 | 2026-02 | Minor API updates, same worktree/branch APIs |
| RAC Tree (beta) | RAC Tree (GA 1.16.0) | 2025 | Tree + TreeItem now stable, drag-and-drop added |
| tauri-plugin-dialog v1 | tauri-plugin-dialog v2 | 2024 | New permission model, same `open()` API |

## Open Questions

1. **Worktree default location**
   - What we know: Worktrees need a filesystem path. Auto-generation pattern like `~/.superagent/worktrees/{repo}-{branch}` is common.
   - What's unclear: Should this be configurable now or deferred to Phase 6 (SETT-03)?
   - Recommendation: Hardcode `~/.superagent/worktrees/` for Phase 4. Phase 6 adds the settings UI.

2. **StatusBar repo/branch info (STAT-01)**
   - What we know: StatusBar currently shows pane count only. STAT-01 says "repo name, branch type icon, branch name, pane count."
   - What's unclear: STAT-01 was marked Complete in Phase 3 traceability, but the actual component only shows pane count + shortcut hints.
   - Recommendation: Update StatusBar in Phase 4 to show active workspace repo name + current branch once workspace-store exists.

3. **Workspace persistence**
   - What we know: Imported repos should survive app restart. `tauri-plugin-store` already used for theme.
   - What's unclear: Persist just paths (reopen each time) or cached repo data?
   - Recommendation: Persist just paths array to `settings.json`. Reopen and enumerate on app launch.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 + @testing-library/react 16.3.2 (TS), cargo test (Rust) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `bun run test` |
| Full suite command | `bun run test && cd src-tauri && cargo test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GIT-01 | Import repo returns branches + worktrees | unit (Rust) | `cd src-tauri && cargo test git::tests` | Wave 0 |
| GIT-02 | List/create/delete branches via git2 | unit (Rust) | `cd src-tauri && cargo test git::tests` | Wave 0 |
| GIT-03 | Create/remove worktrees via git2 | unit (Rust) | `cd src-tauri && cargo test git::tests` | Wave 0 |
| GIT-04 | Create modal renders type cards + form | unit (TS) | `bun run test -- CreateModal` | Wave 0 |
| GIT-05 | Modal shows correct git command preview | unit (TS) | `bun run test -- CreateModal` | Wave 0 |
| GIT-06 | Ahead/behind displayed for tracked branches | unit (Rust + TS) | `cd src-tauri && cargo test git::tests` | Wave 0 |
| SIDE-01 | Sidebar visible/hidden, width state | unit (TS) | `bun run test -- workspace-store` | Wave 0 |
| SIDE-02 | Tree renders repos with branches + worktrees | unit (TS) | `bun run test -- WorkspaceTree` | Wave 0 |
| SIDE-05 | Import button triggers dialog | unit (TS) | `bun run test -- Sidebar` | Wave 0 |
| SIDE-06 | "+ new" button present in expanded repo | unit (TS) | `bun run test -- WorkspaceTree` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test`
- **Per wave merge:** `bun run test && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src-tauri/src/git.rs` -- Rust git module with `#[cfg(test)] mod tests` covering GIT-01..06
- [ ] `src/stores/__tests__/workspace-store.test.ts` -- workspace store unit tests
- [ ] `src/components/__tests__/WorkspaceTree.test.tsx` -- tree component tests
- [ ] `src/components/__tests__/CreateModal.test.tsx` -- modal form + preview tests
- [ ] `src/components/__tests__/Sidebar.test.tsx` -- sidebar visibility/resize tests

## Sources

### Primary (HIGH confidence)
- [git2 0.20.4 Repository docs](https://docs.rs/git2/0.20.4/git2/struct.Repository.html) - branches, worktree, graph_ahead_behind APIs
- [git2 0.20.4 Branch docs](https://docs.rs/git2/0.20.4/git2/struct.Branch.html) - delete, upstream, is_head
- [git2 0.20.4 Worktree docs](https://docs.rs/git2/0.20.4/git2/struct.Worktree.html) - prune, lock, validate
- [git2 0.20.4 WorktreeAddOptions docs](https://docs.rs/git2/0.20.4/git2/struct.WorktreeAddOptions.html) - reference, lock, checkout_existing
- [git2-rs source: repo.rs worktree() method](https://github.com/rust-lang/git2-rs/blob/master/src/repo.rs) - `fn worktree(name, path, opts)` confirmed
- [git2-rs source: worktree.rs tests](https://github.com/rust-lang/git2-rs/blob/master/src/worktree.rs) - smoke tests for add, lock, from_branch
- [React ARIA Tree](https://react-aria.adobe.com/Tree) - Tree, TreeItem, TreeItemContent API
- [React ARIA Modal/Dialog](https://react-aria.adobe.com/Modal) - DialogTrigger, Modal, ModalOverlay, Dialog API
- [tauri-plugin-dialog](https://v2.tauri.app/plugin/dialog/) - open(), directory picker
- [libgit2 graph_ahead_behind](https://libgit2.org/docs/reference/main/graph/git_graph_ahead_behind.html) - C API backing git2-rs

### Secondary (MEDIUM confidence)
- [git2 crate on crates.io](https://crates.io/crates/git2) - version 0.20.4 confirmed current
- [tauri-plugin-dialog crate](https://crates.io/crates/tauri-plugin-dialog) - version 2.4+ confirmed

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - git2 0.20.4 API verified from source code and docs.rs. React ARIA Tree/Dialog verified from official docs.
- Architecture: HIGH - Follows exact same patterns as existing pty.rs (Rust) and tabs-store.ts (frontend). Well-established in codebase.
- Pitfalls: HIGH - git2::Repository !Send confirmed from docs. Worktree path/lock issues confirmed from test suite. Ahead/behind upstream edge case confirmed from API signatures.

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable libraries, no imminent breaking changes)
