# Sidebar Redesign & Worktree Command Palette

## Overview

Replace the current sidebar (which shows all branches/worktrees on import) with a clean, Linear-inspired sidebar that only shows the default branch. Add a command palette modal for creating worktrees and opening existing ones, with full git-awareness to prevent invalid operations.

## 1. Sidebar Redesign — "Accent + Inline + Hover"

### Visual Style

Linear-inspired dark theme using existing CSS custom properties (`--accent`, `--bg-secondary`, `--text-primary`, `--text-muted`, `--border`).

**Layout:**
- `PROJECTS` section header: 10px, uppercase, `letter-spacing: 1px`, color `#444`
- Repo rows: chevron (▸/▾) + repo house icon (14px SVG) + name + hover-reveal `+` button
- Child rows: indented 39px, branch icon (●) or worktree icon (□ rounded rect) + name + status

**Active repo indicators:**
- Left accent bar: 3px solid `var(--accent)` on the active repo
- Subtle glow: `filter: drop-shadow(0 0 3px)` on active repo icon
- Agent status dots glow: `box-shadow: 0 0 4px` with status color

**Expanded state:**
- Shows HEAD branch row (with `HEAD` badge) + opened worktree rows
- Branch rows show `local`/`origin` tag + ahead/behind counts + agent status dot
- Worktree rows show agent status dot

**Collapsed state:**
- Single line: chevron ▸ + repo icon + name + `·` + HEAD branch name (11px, muted) + child count badge + agent dots
- Badge: pill style (`font-size: 10px`, `background: #1a1a2e`, `border-radius: 8px`)

**Hover behavior:**
- `+` button appears on hover (20x20px, `border-radius: 4px`, `background: rgba(accent, 0.1)`)
- `...` menu button appears on hover (for Close Project, etc.)
- When not hovered: only repo name and static indicators visible

**Import button (bottom):**
- Dashed border style: `border: 1px dashed #252530`, `border-radius: 6px`
- Content: `+` icon + "Import"
- Centered, muted color

### Behavior Changes

- **On import:** Only store the HEAD branch — `import_repo` Rust command returns only the HEAD branch, not all branches and worktrees
- **Remove** the `+ New Branch` inline tree item from `WorkspaceTree`
- **Remove** the existing `CreateModal` component — replaced by the command palette
- **Keep** `CloseProjectModal` (confirmation dialog)
- **Keep** collapse/expand via chevron (existing `toggleExpanded`)
- **Keep** context menu on right-click (Close Project)

### Components to Modify

| Component | Change |
|-----------|--------|
| `WorkspaceTree.tsx` | Remove `BranchRow` for non-HEAD branches, remove `+ New Branch` tree item, add `+` hover button on `RepoHeader`, remove `CreateModal` import |
| `Sidebar.tsx` | Update import button styling to dashed border |
| `RepoHeader` (in WorkspaceTree) | Add chevron, accent bar, inline branch for collapsed, hover-reveal actions |
| `CreateModal.tsx` | **Delete** — replaced by `WorkspacePalette` |

### New Components

| Component | Purpose |
|-----------|---------|
| `WorkspacePalette.tsx` | Command palette modal (see Section 2) |

## 2. Command Palette Modal — `WorkspacePalette`

### Trigger

Click the `+` hover button on a repo row. Opens as a portal overlay (like existing modals).

### Props

```typescript
interface WorkspacePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}
```

### States & Transitions

```
┌─────────────────────────────────────────────────┐
│ BROWSE MODE (default)                           │
│                                                 │
│ User sees all branches + worktrees              │
│ Can click "Create WT" or "Open"                 │
│                                                 │
│ ─── User types unknown name ───────────────► ┌──┴──────────────┐
│                                               │ CREATE MODE      │
│ ─── User clicks "Create WT" ──────────────► │                  │
│     on available branch                       │ Create card at   │
│                                               │ top with "from"  │
│                                               │ chip             │
│                                               │                  │
│                                               │ ─── Click chip ──┴──► BASE PICKER │
│                                               │ ─── ⌘↵ ──────────► create + close │
│                                               └──┬──────────────┘
│                                                  │
│ ─── User types existing branch name ──────► ┌──┴──────────────┐
│                                               │ CONFLICT STATE   │
│                                               │ Warning + options│
│                                               └─────────────────┘
└─────────────────────────────────────────────────┘
```

### Browse Mode (Default)

**Search bar:**
- Top of modal, no header/title
- Placeholder: "Search or create new branch..."
- Search icon (magnifier) on left, `ESC` badge on right
- Filters both branches and worktrees as user types

**Tab bar:**
- Two tabs: `All (N)` and `Worktrees (N)`
- N = total count for that category
- Styled as segmented control: `background: #0e0e16`, `border-radius: 6px`, `padding: 2px`
- Active tab: `background: #1a1a2e`, white text

**Branch list (All tab):**

Each branch item shows contextual status and action:

| Branch State | Visual | Action |
|---|---|---|
| HEAD (checked out in main repo) | `● main` + `HEAD` blue badge | Disabled — "checked out" gray text |
| Local, not in worktree | `● feat/auth` + `local` amber badge | "Create WT" blue button |
| Origin-only | `● develop` + `origin` gray badge | "Create WT" blue button |
| Already in a worktree | `● feat/sidebar` + `in worktree` red badge | Disabled — "in use" gray text |

Disabled items render at `opacity: 0.5`.

**Worktree list (All tab, below branches):**

Separated by a `1px #1e1e2e` border + `WORKTREES` section label.

| Worktree State | Visual | Action |
|---|---|---|
| Existing, not in sidebar | `□ wt-sidebar` | "Open" green button |
| Existing, already in sidebar | `□ wt-sidebar` | Disabled — "opened" gray text |

**Worktrees tab:**
- Shows only worktrees with path preview (10px, truncated) and "Open" button
- Bottom hint: "Worktrees already on disk. Click Open to add to sidebar."

### Create Mode

Activates when user types a name that doesn't match any existing branch.

**Create card** appears at top of the list:
- Blue tinted background: `rgba(accent, 0.05)`, blue border
- Content: `+ Create "feat/new-modal"` (bold, blue)
- Below: `from` label + clickable base chip showing current base (defaults to HEAD)
- `⌘↵` badge on right

**Base chip:**
- Shows: `from ● main ▾`
- Styled as: `background: #1a1a2e`, `border: 1px solid #2a2a3e`, `border-radius: 5px`
- Click opens base picker (replaces branch list with selectable branches, checkmark on current)

**Git command preview** in footer:
- `git worktree add -b feat/new-modal ... main`
- Monospace, muted color

### Direct Create (Click "Create WT" on Existing Branch)

When user clicks "Create WT" on an available branch:
- Branch row expands inline with confirmation panel
- Shows: "Create worktree for **develop**"
- Git command preview: `git worktree add ~/.superagent/worktrees/{repoName}-{branchName} origin/develop`
- Worktree path convention: `~/.superagent/worktrees/{repoName}-{branchName}` (hardcoded, matches existing behavior)
- Cancel + Create buttons
- `↵` confirms, `ESC` cancels back to browse

### Conflict State

When user types a name matching an existing branch:
- Amber warning card replaces create card
- Title: `Branch "develop" already exists`
- Two inline options:
  1. "Use a different name" — focuses search input
  2. "Create worktree for develop directly" — triggers direct create flow

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑↓` | Navigate list items |
| `↵` | Execute action on focused item (create/open/confirm) |
| `⌘↵` | Confirm create (in create mode) |
| `ESC` | Close palette (or exit sub-state first) |
| Type | Filter list / enter create mode |

### Empty State (Fresh Repo)

When repo has only HEAD branch and no worktrees:
- Branch list shows only HEAD (disabled)
- Centered empty icon + "No other branches or worktrees"
- Hint: "Type a name above to create a new branch & worktree from **main**"

## 3. Data & Backend Changes

### Rust Backend (`git.rs`)

**Modify `import_repo`:**
- Only return the HEAD branch, not all branches and worktrees
- Signature stays the same, just filters the result

**New command: `list_all_branches`:**
```rust
#[tauri::command]
fn list_all_branches(repo_path: String) -> Result<Vec<BranchDetail>, String>

struct BranchDetail {
    name: String,
    is_head: bool,
    is_local: bool,
    is_in_worktree: bool,
}
```
- Called when palette opens to get fresh branch data
- Checks each branch against worktree list to set `is_in_worktree`

**Existing commands (no changes needed):**
- `create_worktree(repo_path, name, path, base_branch?)` — already supports `-b` new branch
- `remove_worktree`, `create_branch`, `delete_branch` — unchanged

### Frontend API (`git.ts`)

**New type + wrapper:**
```typescript
interface BranchDetail {
  name: string;
  is_head: boolean;
  is_local: boolean;
  is_in_worktree: boolean;
}

function listAllBranches(repoPath: string): Promise<BranchDetail[]>
```

### Frontend Actions (`workspace-actions.ts`)

**Modify `importRepo`:**
- After calling `gitApi.importRepo(path)`, only store the HEAD branch in `workspace.branches`
- Set `workspace.worktrees` to `[]`

**New: `openWorktree(wsId, worktreeName, worktreePath)`:**
- Add the worktree to `workspace.worktrees` array in the collection
- No git operation needed — worktree already exists on disk

**Existing actions (no changes):**
- `createWorktree` — already calls Rust, refreshes repo
- `createBranch` — already calls Rust, refreshes repo

### Collection Changes

No schema changes needed. `Workspace.branches` and `Workspace.worktrees` arrays already exist — we just populate them differently (only HEAD on import, add items explicitly via palette).

## 4. Files Summary

### Delete
- `apps/desktop/src/components/CreateModal.tsx`

### New
- `apps/desktop/src/components/WorkspacePalette.tsx`

### Modify
- `apps/desktop/src/components/WorkspaceTree.tsx` — sidebar restyle, remove old modal, add palette trigger
- `apps/desktop/src/components/Sidebar.tsx` — import button restyle
- `apps/desktop/src/lib/workspace-actions.ts` — importRepo filter, openWorktree action
- `apps/desktop/src/lib/git.ts` — add `listAllBranches` type + wrapper
- `apps/desktop/src-tauri/src/git.rs` — modify `import_repo`, add `list_all_branches`
- `apps/desktop/src-tauri/src/lib.rs` — register new command

### No Changes
- `packages/db/src/collections/workspaces.ts` — schema unchanged
- `apps/desktop/src/components/CloseProjectModal.tsx` — kept as-is

## 5. Verification

```bash
cd apps/desktop && bun run test
cd apps/desktop/src-tauri && cargo test
```
