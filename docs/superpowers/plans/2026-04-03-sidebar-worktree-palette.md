# Sidebar Redesign & Worktree Command Palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "show everything" sidebar with a clean Linear-inspired sidebar that only shows HEAD + explicitly opened worktrees, and add a command palette for creating/opening worktrees with full git-awareness.

**Architecture:** Rust backend gets a new `list_all_branches` command that returns branch status (HEAD, local, in-worktree). Frontend replaces `CreateModal` with a `WorkspacePalette` command palette component. `WorkspaceTree` is restyled with accent bar, hover-reveal actions, and collapse/expand with inline branch.

**Tech Stack:** Tauri v2 (Rust + git2), React 19, React ARIA, TypeScript, Tailwind CSS v4, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-04-03-sidebar-worktree-palette-design.md`

---

## File Structure

### New Files

| File                                                              | Responsibility                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/desktop/src/components/WorkspacePalette.tsx`                | Command palette modal — search, tabs, branch list, create/open flows |
| `apps/desktop/src/components/__tests__/WorkspacePalette.test.tsx` | Tests for palette states, filtering, create/open actions             |

### Modified Files

| File                                            | Changes                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri/src/git.rs`             | Add `BranchDetail` struct + `list_all_branches` command; modify `import_repo` to return HEAD-only          |
| `apps/desktop/src-tauri/src/lib.rs`             | Register `list_all_branches` in invoke handler                                                             |
| `apps/desktop/src/lib/git.ts`                   | Add `BranchDetail` type + `listAllBranches` wrapper                                                        |
| `apps/desktop/src/lib/workspace-actions.ts`     | Filter `importRepo` to HEAD-only; add `openWorktree` action                                                |
| `apps/desktop/src/components/WorkspaceTree.tsx` | Full restyle — accent bar, chevron, hover-reveal `+`, collapsed inline branch, remove old modal references |
| `apps/desktop/src/components/Sidebar.tsx`       | Restyle import button to dashed border                                                                     |

### Deleted Files

| File                                          | Reason                         |
| --------------------------------------------- | ------------------------------ |
| `apps/desktop/src/components/CreateModal.tsx` | Replaced by `WorkspacePalette` |

---

## Task 1: Rust — `list_all_branches` command

**Files:**

- Modify: `apps/desktop/src-tauri/src/git.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the test for `list_all_branches`**

Add to the `mod tests` block in `git.rs`:

```rust
#[test]
fn test_list_all_branches() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    let path = tmp.path().to_string_lossy().to_string();

    // Create a second branch
    let branches_before = list_branches(path.clone()).unwrap();
    let default_branch = &branches_before[0].name;
    create_branch(path.clone(), "feature/test".to_string(), default_branch.clone()).unwrap();

    let details = list_all_branches(path).unwrap();
    assert!(details.len() >= 2);

    // HEAD branch
    let head = details.iter().find(|b| b.is_head).unwrap();
    assert!(head.is_local);
    assert!(!head.is_in_worktree);

    // Feature branch
    let feat = details.iter().find(|b| b.name == "feature/test").unwrap();
    assert!(!feat.is_head);
    assert!(feat.is_local);
    assert!(!feat.is_in_worktree);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test test_list_all_branches`
Expected: FAIL — `list_all_branches` not found

- [ ] **Step 3: Add `BranchDetail` struct and `list_all_branches` command**

Add the struct after the existing `RepoInfo` struct (around line 25 in `git.rs`):

```rust
#[derive(Serialize, Clone)]
pub struct BranchDetail {
    pub name: String,
    pub is_head: bool,
    pub is_local: bool,
    pub is_in_worktree: bool,
}
```

Add the command after `list_branches` (around line 102):

```rust
#[tauri::command]
pub fn list_all_branches(repo_path: String) -> Result<Vec<BranchDetail>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Collect worktree branch names for cross-reference
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut wt_branch_names: Vec<String> = Vec::new();
    for wt_name in wt_names.iter() {
        let wt_name = wt_name.ok_or("invalid worktree name")?;
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.validate().is_ok() {
                // Open the worktree's repo to find its HEAD branch
                let wt_path = wt.path();
                if let Ok(wt_repo) = Repository::open(wt_path) {
                    if let Ok(head) = wt_repo.head() {
                        if let Some(name) = head.shorthand() {
                            wt_branch_names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    let mut details = Vec::new();

    // Local branches
    for branch_result in repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)").to_string();
        let is_head = branch.is_head();
        let is_in_worktree = wt_branch_names.contains(&name);

        details.push(BranchDetail {
            name,
            is_head,
            is_local: true,
            is_in_worktree,
        });
    }

    // Remote branches (origin only, skip if already local)
    let local_names: Vec<String> = details.iter().map(|d| d.name.clone()).collect();
    for branch_result in repo.branches(Some(BranchType::Remote)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let full_name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)").to_string();
        // Strip "origin/" prefix
        let short_name = full_name.strip_prefix("origin/").unwrap_or(&full_name).to_string();
        // Skip HEAD pointer and branches that already exist locally
        if short_name == "HEAD" || local_names.contains(&short_name) {
            continue;
        }
        details.push(BranchDetail {
            name: short_name,
            is_head: false,
            is_local: false,
            is_in_worktree: false,
        });
    }

    Ok(details)
}
```

- [ ] **Step 4: Register the command in `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, add `git::list_all_branches` to the `invoke_handler` list (after `git::list_branches` on line 57):

```rust
git::list_all_branches,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test test_list_all_branches`
Expected: PASS

- [ ] **Step 6: Write test for worktree branch detection**

```rust
#[test]
fn test_list_all_branches_detects_worktree() {
    let tmp = TempDir::new().unwrap();
    let _repo = init_repo_with_commit(tmp.path());
    let path = tmp.path().to_string_lossy().to_string();

    let branches = list_branches(path.clone()).unwrap();
    let default_branch = &branches[0].name;

    // Create a branch and a worktree for it
    create_branch(path.clone(), "wt-branch".to_string(), default_branch.clone()).unwrap();
    let wt_tmp = TempDir::new().unwrap();
    let wt_path = wt_tmp.path().join("test-wt");
    create_worktree(
        path.clone(),
        "test-wt".to_string(),
        wt_path.to_string_lossy().to_string(),
        Some("wt-branch".to_string()),
    ).unwrap();

    let details = list_all_branches(path).unwrap();
    let wt_branch = details.iter().find(|b| b.name == "wt-branch").unwrap();
    assert!(wt_branch.is_in_worktree);
}
```

- [ ] **Step 7: Run test**

Run: `cd apps/desktop/src-tauri && cargo test test_list_all_branches_detects_worktree`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/git.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add list_all_branches command with worktree detection"
```

---

## Task 2: Rust — Modify `import_repo` to return HEAD-only

**Files:**

- Modify: `apps/desktop/src-tauri/src/git.rs`

- [ ] **Step 1: Update the existing `test_import_repo` test**

Replace the existing `test_import_repo` test with this version that asserts HEAD-only:

```rust
#[test]
fn test_import_repo() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    let path = tmp.path().to_string_lossy().to_string();

    // Create extra branches that should NOT appear in import
    let branches = list_branches(path.clone()).unwrap();
    let default_branch = &branches[0].name;
    create_branch(path.clone(), "extra-branch".to_string(), default_branch.clone()).unwrap();

    let info = import_repo(path).unwrap();
    assert_eq!(info.name, tmp.path().file_name().unwrap().to_string_lossy());
    // Should only have the HEAD branch
    assert_eq!(info.branches.len(), 1);
    assert!(info.branches[0].is_head);
    // Should have no worktrees
    assert!(info.worktrees.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test test_import_repo`
Expected: FAIL — `info.branches.len()` is 2, not 1

- [ ] **Step 3: Modify `import_repo` to filter to HEAD-only**

Replace the `import_repo` function body in `git.rs` (lines 82-96):

```rust
#[tauri::command]
pub fn import_repo(path: String) -> Result<RepoInfo, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let all_branches = enumerate_branches(&repo)?;
    let head_only: Vec<BranchInfo> = all_branches.into_iter().filter(|b| b.is_head).collect();
    Ok(RepoInfo {
        path,
        name,
        branches: head_only,
        worktrees: Vec::new(),
    })
}
```

- [ ] **Step 4: Run all Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: ALL PASS. Note: `test_create_and_remove_worktree` uses `import_repo` to verify removal — it will still pass since it checks `!info.worktrees.iter().any(|w| w.name == "test-wt")` and worktrees is now always empty.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/git.rs
git commit -m "feat: import_repo returns HEAD branch only, no worktrees"
```

---

## Task 3: Frontend — Add `listAllBranches` API + `openWorktree` action

**Files:**

- Modify: `apps/desktop/src/lib/git.ts`
- Modify: `apps/desktop/src/lib/workspace-actions.ts`

- [ ] **Step 1: Add `BranchDetail` type and `listAllBranches` to `git.ts`**

Add after the existing `RepoInfo` interface (after line 20 in `git.ts`):

```typescript
export interface BranchDetail {
  name: string;
  is_head: boolean;
  is_local: boolean;
  is_in_worktree: boolean;
}
```

Add after the existing `listBranches` function (after line 28):

```typescript
export function listAllBranches(repoPath: string): Promise<BranchDetail[]> {
  return invoke<BranchDetail[]>('list_all_branches', { repoPath });
}
```

- [ ] **Step 2: Modify `importRepo` in `workspace-actions.ts` to filter HEAD-only**

The Rust side now returns HEAD-only, but `refreshRepo` still calls `import_repo` which returns HEAD-only too. We need `refreshRepo` to preserve existing worktrees that the user has opened. Replace `refreshRepo` (lines 76-88):

```typescript
export async function refreshRepo(id: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === id);
  if (!ws) return;
  try {
    const info = await gitApi.importRepo(ws.path);
    getWorkspaceCollection().update(id, (draft) => {
      draft.branches = info.branches;
      // Don't overwrite worktrees — import_repo returns [] now,
      // but we want to keep user-opened worktrees in the sidebar.
    });
  } catch (err) {
    showErrorToast('Refresh failed', String(err));
  }
}
```

- [ ] **Step 3: Add `openWorktree` action to `workspace-actions.ts`**

Add after `removeWorktree` (after line 174):

```typescript
export function openWorktree(workspaceId: string, name: string, path: string): void {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  // Don't add if already in the list
  if (ws.worktrees.some((wt) => wt.name === name)) return;
  getWorkspaceCollection().update(workspaceId, (draft) => {
    draft.worktrees.push({ name, path });
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/git.ts apps/desktop/src/lib/workspace-actions.ts
git commit -m "feat: add listAllBranches API and openWorktree action"
```

---

## Task 4: Sidebar — Restyle `WorkspaceTree` (Linear "Accent + Inline + Hover")

**Files:**

- Modify: `apps/desktop/src/components/WorkspaceTree.tsx`
- Modify: `apps/desktop/src/components/Sidebar.tsx`

- [ ] **Step 1: Restyle `Sidebar.tsx` import button**

Replace the import button section (lines 96-104 in `Sidebar.tsx`):

```tsx
<div className="flex-shrink-0 border-t border-border p-2">
  <button
    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[var(--text-muted)] cursor-pointer"
    style={{ fontSize: '12px', borderRadius: '6px', border: '1px dashed var(--border)' }}
    onClick={handleImport}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
    Import
  </button>
</div>
```

Also update the `EmptyState` button to match (lines 21-28):

```tsx
<button
  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer"
  style={{ fontSize: '12px', borderRadius: '6px', border: '1px dashed var(--border)' }}
  onClick={onImport}
>
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
  Import Repository
</button>
```

- [ ] **Step 2: Restyle `WorkspaceTree.tsx` — Replace `RepoHeader`**

Replace the `RepoHeader` component (lines 58-99) with the new Linear-style version:

```tsx
function RepoHeader({
  workspace,
  agentSummary,
  isSelected,
  onPlusClick,
}: {
  workspace: Workspace;
  agentSummary?: Array<'running' | 'waiting'>;
  isSelected: boolean;
  onPlusClick: (e: React.MouseEvent) => void;
}) {
  const headBranch = workspace.branches.find((b) => b.is_head);
  const childCount = workspace.branches.length + workspace.worktrees.length;

  return (
    <div
      className="group flex items-center gap-[7px] py-[6px] px-[12px] mx-[6px] rounded-[6px]"
      style={{
        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
        background: isSelected ? 'rgba(var(--accent-rgb, 59 130 246) / 0.04)' : undefined,
      }}
    >
      <Button
        slot="chevron"
        className="text-[var(--text-muted)] bg-transparent border-none p-0 outline-none cursor-pointer"
        style={{ fontSize: '10px', width: '10px', textAlign: 'center' }}
      >
        {workspace.expanded ? (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 6l4 4 4-4z" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6 4l4 4-4 4z" />
          </svg>
        )}
      </Button>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke={isSelected ? 'var(--accent)' : '#555'}
        strokeWidth="1.5"
        style={isSelected ? { filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.4))' } : undefined}
      >
        <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
      </svg>
      <span
        className="font-medium truncate"
        style={{
          fontSize: '13px',
          flex: 1,
          color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {workspace.name}
      </span>
      {/* Collapsed: show inline branch + count */}
      {!workspace.expanded && (
        <>
          <span style={{ color: '#333', margin: '0 2px' }}>·</span>
          <span style={{ fontSize: '11px', color: '#444' }}>{headBranch?.name ?? 'main'}</span>
          {agentSummary && agentSummary.length > 0 && (
            <span className="flex items-center" style={{ gap: '3px', marginLeft: '4px' }}>
              {agentSummary.slice(0, 3).map((status, i) => (
                <StatusDot key={i} status={status} size={5} />
              ))}
            </span>
          )}
          {childCount > 0 && (
            <span
              style={{
                fontSize: '10px',
                color: '#444',
                background: '#1a1a2e',
                padding: '1px 6px',
                borderRadius: '8px',
              }}
            >
              {childCount}
            </span>
          )}
        </>
      )}
      {/* Hover-reveal + button */}
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '4px',
          background: 'rgba(59,130,246,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        onClick={onPlusClick}
        role="button"
        aria-label="Add workspace"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onPlusClick(e as unknown as React.MouseEvent);
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `BranchRow` and `WorktreeRow` styling**

Replace `BranchRow` (lines 20-40):

```tsx
function BranchRow({ branch, agentStatus }: { branch: BranchInfo; agentStatus?: DotStatus }) {
  return (
    <div
      className="flex items-center gap-[6px] py-[4px] px-[10px] rounded-[5px]"
      style={{
        marginLeft: '39px',
        marginRight: '6px',
        marginTop: '1px',
        marginBottom: '1px',
        background: branch.is_head ? 'rgba(59,130,246,0.1)' : undefined,
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke={branch.is_head ? 'var(--accent)' : '#555'}
        strokeWidth="2"
      >
        <circle cx="8" cy="8" r="3" />
      </svg>
      <span
        style={{
          fontSize: '13px',
          fontWeight: branch.is_head ? 500 : 400,
          color: branch.is_head ? 'var(--text-primary)' : 'var(--text-muted)',
          flex: 1,
        }}
        className="truncate"
      >
        {branch.name}
      </span>
      {branch.is_head && (
        <span
          style={{
            fontSize: '9px',
            color: 'var(--accent)',
            background: 'rgba(59,130,246,0.1)',
            padding: '1px 5px',
            borderRadius: '3px',
          }}
        >
          HEAD
        </span>
      )}
      {agentStatus && agentStatus !== 'idle' && <StatusDot status={agentStatus} size={6} />}
      <span className="flex gap-1" style={{ fontSize: '11px' }}>
        {branch.ahead > 0 && <span style={{ color: 'var(--git-ahead)' }}>+{branch.ahead}</span>}
        {branch.behind > 0 && <span style={{ color: 'var(--git-behind)' }}>-{branch.behind}</span>}
      </span>
    </div>
  );
}
```

Replace `WorktreeRow` (lines 43-56):

```tsx
function WorktreeRow({
  worktree,
  agentStatus,
}: {
  worktree: WorktreeInfo;
  agentStatus?: DotStatus;
}) {
  return (
    <div
      className="flex items-center gap-[6px] py-[4px] px-[10px] rounded-[5px]"
      style={{ marginLeft: '39px', marginRight: '6px', marginTop: '1px', marginBottom: '1px' }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#555" strokeWidth="1.5">
        <rect x="3" y="3" width="10" height="10" rx="2" />
      </svg>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)', flex: 1 }} className="truncate">
        {worktree.name}
      </span>
      {agentStatus && agentStatus !== 'idle' && <StatusDot status={agentStatus} size={6} />}
    </div>
  );
}
```

- [ ] **Step 4: Update `RepoTreeItem` — remove `+ New Branch`, add palette trigger**

In the `RepoTreeItem` function, replace the `TreeItemContent` for the repo header to pass `onPlusClick` and `isSelected`:

Replace the `TreeItemContent` section inside `RepoTreeItem` that renders `RepoHeader`:

```tsx
<TreeItemContent>
  <div onContextMenu={handleContextMenu}>
    <RepoHeader
      workspace={ws}
      agentSummary={agentSummary}
      isSelected={!!selectedItemId?.startsWith(ws.id)}
      onPlusClick={(e) => {
        e.stopPropagation();
        setModalWorkspace(ws);
      }}
    />
  </div>
</TreeItemContent>
```

You'll need to get `selectedItemId` in `RepoTreeItem`. Add it to the props:

```tsx
function RepoTreeItem({
  ws,
  agentMap,
  setModalWorkspace,
  onRequestClose,
  selectedItemId,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  setModalWorkspace: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  selectedItemId: string | null;
}) {
```

Pass it from `WorkspaceTree`:

```tsx
<RepoTreeItem
  key={ws.id}
  ws={ws}
  agentMap={agentMap}
  setModalWorkspace={setModalWorkspace}
  onRequestClose={setCloseTarget}
  selectedItemId={selectedItemId}
/>
```

Remove the `+ New Branch` TreeItem (lines 354-375 approximately — the last child TreeItem with `id={ws.id}-new-branch`).

- [ ] **Step 5: Add PROJECTS section header to `WorkspaceTree`**

In the `WorkspaceTree` component, add a section header before the `<Tree>`:

```tsx
return (
  <>
    <div style={{ padding: '4px 12px 6px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: '#444' }}>
      Projects
    </div>
    <Tree
      aria-label="Workspaces"
      // ... rest stays the same
    >
```

- [ ] **Step 6: Replace `CreateModal` with `WorkspacePalette` import**

In `WorkspaceTree`, replace the `CreateModal` import and usage:

Change the import (line 17):

```tsx
import { WorkspacePalette } from './WorkspacePalette';
```

Replace the `CreateModal` render block (around line 224-230):

```tsx
{
  modalWorkspace && (
    <WorkspacePalette
      isOpen={!!modalWorkspace}
      onClose={() => setModalWorkspace(null)}
      workspace={modalWorkspace}
    />
  );
}
```

- [ ] **Step 7: Update `TreeItem` styling to remove old active styles**

Replace the `className` on branch/worktree `TreeItem` components. Remove the `border-l-2 border-l-[var(--accent)]` — the accent is now on the repo row, not children:

```tsx
className={({ isSelected }) =>
  `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`
}
```

Also update the repo-level `TreeItem`:

```tsx
className = 'outline-none cursor-pointer';
```

(The accent bar is now handled inside `RepoHeader`, not via TreeItem className.)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/components/WorkspaceTree.tsx apps/desktop/src/components/Sidebar.tsx
git commit -m "feat: restyle sidebar with Linear design — accent bar, hover-reveal, collapse inline"
```

---

## Task 5: Build `WorkspacePalette` — Browse mode

**Files:**

- Create: `apps/desktop/src/components/WorkspacePalette.tsx`
- Create: `apps/desktop/src/components/__tests__/WorkspacePalette.test.tsx`

- [ ] **Step 1: Write tests for browse mode**

Create `apps/desktop/src/components/__tests__/WorkspacePalette.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspacePalette, type WorkspacePaletteProps } from '../WorkspacePalette';

// Mock the git API
vi.mock('../../lib/git', () => ({
  listAllBranches: vi.fn().mockResolvedValue([
    { name: 'main', is_head: true, is_local: true, is_in_worktree: false },
    { name: 'develop', is_head: false, is_local: false, is_in_worktree: false },
    { name: 'feat/auth', is_head: false, is_local: true, is_in_worktree: false },
    { name: 'feat/sidebar', is_head: false, is_local: true, is_in_worktree: true },
  ]),
  listBranches: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/workspace-actions', () => ({ createWorktree: vi.fn(), openWorktree: vi.fn() }));

const baseWorkspace = {
  id: 'ws-1',
  path: '/tmp/repo',
  name: 'my-repo',
  branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
  worktrees: [{ name: 'wt-sidebar', path: '/tmp/wt-sidebar' }],
  expanded: true,
  position: 0,
};

describe('WorkspacePalette', () => {
  let props: WorkspacePaletteProps;

  beforeEach(() => {
    props = { isOpen: true, onClose: vi.fn(), workspace: baseWorkspace };
  });

  it('renders nothing when isOpen is false', () => {
    render(<WorkspacePalette {...props} isOpen={false} />);
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull();
  });

  it('renders search input when open', async () => {
    render(<WorkspacePalette {...props} />);
    expect(screen.getByPlaceholderText(/Search or create/)).toBeDefined();
  });

  it('shows All and Worktrees tabs', async () => {
    render(<WorkspacePalette {...props} />);
    expect(screen.getByText(/All/)).toBeDefined();
    expect(screen.getByText(/Worktrees/)).toBeDefined();
  });

  it('closes on Escape', () => {
    render(<WorkspacePalette {...props} />);
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    render(<WorkspacePalette {...props} />);
    fireEvent.click(screen.getByRole('presentation'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun run test -- --run WorkspacePalette`
Expected: FAIL — module not found

- [ ] **Step 3: Create `WorkspacePalette.tsx` with browse mode**

Create `apps/desktop/src/components/WorkspacePalette.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Workspace } from '@superagent/db';
import { listAllBranches, type BranchDetail } from '../lib/git';
import { createWorktree, openWorktree } from '../lib/workspace-actions';

export interface WorkspacePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}

type Tab = 'all' | 'worktrees';

export function WorkspacePalette({ isOpen, onClose, workspace }: WorkspacePaletteProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [baseBranch, setBaseBranch] = useState('');
  const [pickingBase, setPickingBase] = useState(false);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load branches when palette opens
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setTab('all');
    setConfirmBranch(null);
    setPickingBase(false);
    listAllBranches(workspace.path)
      .then(setBranches)
      .catch(() => {});
    const head = workspace.branches.find((b) => b.is_head);
    setBaseBranch(head?.name ?? 'main');
    // Focus input after render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen, workspace]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickingBase) {
          setPickingBase(false);
        } else if (confirmBranch) {
          setConfirmBranch(null);
        } else {
          onClose();
        }
      }
      if (e.key === 'Enter' && e.metaKey && isCreateMode) {
        handleCreateNew();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose, pickingBase, confirmBranch],
  );

  // Filtered branches
  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(query.toLowerCase()),
  );

  // Does the query match an existing branch name exactly?
  const exactMatch = branches.find((b) => b.name.toLowerCase() === query.trim().toLowerCase());

  // Create mode: user typed something that doesn't match any branch
  const isCreateMode = query.trim().length > 0 && !exactMatch;
  const isConflictMode =
    query.trim().length > 0 && exactMatch && !exactMatch.is_head && !exactMatch.is_in_worktree;

  // Worktrees from workspace (already opened or on disk)
  const diskWorktrees = workspace.worktrees;
  const filteredWorktrees = diskWorktrees.filter((wt) =>
    wt.name.toLowerCase().includes(query.toLowerCase()),
  );

  async function handleCreateNew() {
    const name = query.trim();
    if (!name) return;
    const wtPath = `~/.superagent/worktrees/${workspace.name}-${name}`;
    await createWorktree(workspace.id, name, wtPath, baseBranch);
    onClose();
  }

  async function handleCreateFromBranch(branchName: string) {
    const wtPath = `~/.superagent/worktrees/${workspace.name}-${branchName}`;
    await createWorktree(workspace.id, branchName, wtPath, branchName);
    onClose();
  }

  function handleOpenWorktree(name: string, path: string) {
    openWorktree(workspace.id, name, path);
    onClose();
  }

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="w-[440px] overflow-hidden"
        style={{
          background: '#161622',
          border: '1px solid #2a2a3e',
          borderRadius: '10px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Search bar */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid #1e1e2e' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setConfirmBranch(null);
            }}
            placeholder="Search or create new branch..."
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)]"
            style={{ fontSize: '14px' }}
          />
          <span
            style={{
              fontSize: '10px',
              color: '#444',
              background: '#1a1a2e',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            ESC
          </span>
        </div>

        {/* Create card (when in create mode) */}
        {isCreateMode && !pickingBase && (
          <div
            className="mx-2 mt-2 p-3 rounded-lg"
            style={{
              background: 'rgba(59,130,246,0.05)',
              border: '1px solid rgba(59,130,246,0.15)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              <span style={{ fontWeight: 500, color: 'var(--accent)', flex: 1, fontSize: '13px' }}>
                Create "{query.trim()}"
              </span>
              <span style={{ fontSize: '10px', color: '#555', fontFamily: 'monospace' }}>⌘↵</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: '11px', color: '#555' }}>from</span>
              <button
                onClick={() => setPickingBase(true)}
                className="flex items-center gap-1 px-2 py-0.5 cursor-pointer"
                style={{
                  background: '#1a1a2e',
                  border: '1px solid #2a2a3e',
                  borderRadius: '5px',
                  fontSize: '11px',
                }}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                >
                  <circle cx="8" cy="8" r="3" />
                </svg>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{baseBranch}</span>
                <svg width="8" height="8" viewBox="0 0 16 16" fill="#555">
                  <path d="M4 6l4 4 4-4z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div
          className="flex gap-0.5 mx-2 mt-2 p-0.5 rounded-[6px]"
          style={{ background: '#0e0e16' }}
        >
          <button
            onClick={() => setTab('all')}
            className="flex-1 flex items-center justify-center gap-1 py-[5px] px-2 rounded cursor-pointer border-none"
            style={{
              fontSize: '12px',
              background: tab === 'all' ? '#1a1a2e' : 'transparent',
              color: tab === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            All{' '}
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(255,255,255,0.06)',
                padding: '0 5px',
                borderRadius: '8px',
              }}
            >
              {branches.length}
            </span>
          </button>
          <button
            onClick={() => setTab('worktrees')}
            className="flex-1 flex items-center justify-center gap-1 py-[5px] px-2 rounded cursor-pointer border-none"
            style={{
              fontSize: '12px',
              background: tab === 'worktrees' ? '#1a1a2e' : 'transparent',
              color: tab === 'worktrees' ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            Worktrees{' '}
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(255,255,255,0.06)',
                padding: '0 5px',
                borderRadius: '8px',
              }}
            >
              {diskWorktrees.length}
            </span>
          </button>
        </div>

        {/* Content area */}
        <div className="px-2 pb-2" style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {tab === 'all' && !pickingBase && (
            <>
              <div
                style={{
                  fontSize: '10px',
                  color: '#444',
                  padding: '6px 8px 4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Branches
              </div>
              {filteredBranches.length === 0 && (
                <div
                  style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    color: '#333',
                    fontSize: '12px',
                  }}
                >
                  {query ? `No branches match "${query}"` : 'No branches'}
                </div>
              )}
              {filteredBranches.map((b) => (
                <BranchItem
                  key={b.name}
                  branch={b}
                  isConfirming={confirmBranch === b.name}
                  workspace={workspace}
                  onCreateWT={() => {
                    if (b.is_head || b.is_in_worktree) return;
                    setConfirmBranch(b.name);
                  }}
                  onConfirmCreate={() => handleCreateFromBranch(b.name)}
                  onCancelConfirm={() => setConfirmBranch(null)}
                />
              ))}

              {/* Worktrees section */}
              <div
                style={{
                  fontSize: '10px',
                  color: '#444',
                  padding: '6px 8px 4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  borderTop: '1px solid #1e1e2e',
                  marginTop: '4px',
                }}
              >
                Worktrees
              </div>
              {filteredWorktrees.length === 0 && (
                <div
                  style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    color: '#333',
                    fontSize: '12px',
                  }}
                >
                  No worktrees
                </div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem
                  key={wt.name}
                  worktree={wt}
                  onOpen={() => handleOpenWorktree(wt.name, wt.path)}
                />
              ))}
            </>
          )}

          {tab === 'worktrees' && (
            <>
              {filteredWorktrees.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <div
                    style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}
                  >
                    No worktrees
                  </div>
                  <div style={{ fontSize: '12px', color: '#444' }}>Create one from the All tab</div>
                </div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem
                  key={wt.name}
                  worktree={wt}
                  onOpen={() => handleOpenWorktree(wt.name, wt.path)}
                  showPath
                />
              ))}
              {filteredWorktrees.length > 0 && (
                <div
                  style={{
                    padding: '8px',
                    textAlign: 'center',
                    color: '#333',
                    fontSize: '12px',
                    borderTop: '1px solid #1e1e2e',
                    marginTop: '4px',
                  }}
                >
                  Worktrees already on disk. Click Open to add to sidebar.
                </div>
              )}
            </>
          )}

          {/* Base picker mode */}
          {pickingBase && (
            <>
              <div
                style={{
                  fontSize: '10px',
                  color: '#444',
                  padding: '6px 8px 4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Select base branch
              </div>
              {branches
                .filter((b) => !b.is_in_worktree)
                .map((b) => (
                  <div
                    key={b.name}
                    className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px] cursor-pointer hover:bg-[rgba(59,130,246,0.06)]"
                    style={
                      b.name === baseBranch ? { background: 'rgba(59,130,246,0.06)' } : undefined
                    }
                    onClick={() => {
                      setBaseBranch(b.name);
                      setPickingBase(false);
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke={b.name === baseBranch ? 'var(--accent)' : '#555'}
                      strokeWidth="2"
                    >
                      <circle cx="8" cy="8" r="3" />
                    </svg>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: b.name === baseBranch ? 500 : 400,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {b.name}
                    </span>
                    {b.is_head && (
                      <span
                        style={{
                          fontSize: '9px',
                          color: 'var(--accent)',
                          background: 'rgba(59,130,246,0.1)',
                          padding: '1px 5px',
                          borderRadius: '3px',
                        }}
                      >
                        HEAD
                      </span>
                    )}
                    {b.name === baseBranch && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="var(--accent)"
                        style={{ marginLeft: 'auto' }}
                      >
                        <path d="M6 10.8l-2.4-2.4L2 10l4 4 8-8-1.6-1.6z" />
                      </svg>
                    )}
                  </div>
                ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{ borderTop: '1px solid #1e1e2e', fontSize: '11px', color: '#444' }}
        >
          {isCreateMode ? (
            <>
              <span>⌘↵ create worktree</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#555',
                }}
              >
                git worktree add -b <span style={{ color: 'var(--accent)' }}>{query.trim()}</span> …{' '}
                <span style={{ color: 'var(--text-muted)' }}>{baseBranch}</span>
              </span>
            </>
          ) : pickingBase ? (
            <>
              <span>↑↓ select base</span>
              <span>↵ confirm</span>
            </>
          ) : (
            <>
              <span>↑↓ navigate</span>
              <span>↵ create/open</span>
              <span style={{ marginLeft: 'auto' }}>type name → create new</span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BranchItem({
  branch,
  isConfirming,
  workspace,
  onCreateWT,
  onConfirmCreate,
  onCancelConfirm,
}: {
  branch: BranchDetail;
  isConfirming: boolean;
  workspace: Workspace;
  onCreateWT: () => void;
  onConfirmCreate: () => void;
  onCancelConfirm: () => void;
}) {
  const disabled = branch.is_head || branch.is_in_worktree;

  return (
    <div
      style={
        isConfirming
          ? {
              border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: '6px',
              overflow: 'hidden',
              margin: '2px 0',
            }
          : undefined
      }
    >
      <div
        className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px]"
        style={{
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
          background: isConfirming ? 'rgba(59,130,246,0.08)' : undefined,
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke={branch.is_head ? 'var(--accent)' : '#555'}
          strokeWidth="2"
        >
          <circle cx="8" cy="8" r="3" />
        </svg>
        <span
          style={{
            fontSize: '13px',
            fontWeight: branch.is_head ? 500 : 400,
            color: 'var(--text-primary)',
          }}
        >
          {branch.name}
        </span>
        {branch.is_head && (
          <span
            style={{
              fontSize: '9px',
              color: 'var(--accent)',
              background: 'rgba(59,130,246,0.1)',
              padding: '1px 5px',
              borderRadius: '3px',
            }}
          >
            HEAD
          </span>
        )}
        {branch.is_local && !branch.is_head && (
          <span
            style={{
              fontSize: '9px',
              color: '#d97706',
              background: 'rgba(217,119,6,0.1)',
              padding: '1px 5px',
              borderRadius: '3px',
            }}
          >
            local
          </span>
        )}
        {!branch.is_local && (
          <span
            style={{
              fontSize: '9px',
              color: '#555',
              background: 'rgba(255,255,255,0.04)',
              padding: '1px 5px',
              borderRadius: '3px',
            }}
          >
            origin
          </span>
        )}
        {branch.is_in_worktree && (
          <span
            style={{
              fontSize: '9px',
              color: '#ef4444',
              background: 'rgba(239,68,68,0.08)',
              padding: '1px 5px',
              borderRadius: '3px',
            }}
          >
            in worktree
          </span>
        )}
        {disabled ? (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#444' }}>
            {branch.is_head ? 'checked out' : 'in use'}
          </span>
        ) : !isConfirming ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateWT();
            }}
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              color: 'var(--accent)',
              background: 'rgba(59,130,246,0.08)',
              padding: '2px 8px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Create WT
          </button>
        ) : null}
      </div>
      {/* Inline confirmation */}
      {isConfirming && (
        <div
          className="px-2.5 py-2"
          style={{
            background: 'rgba(59,130,246,0.03)',
            borderTop: '1px solid rgba(59,130,246,0.1)',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Create worktree for{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{branch.name}</strong>
          </div>
          <div
            className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded"
            style={{
              background: '#0e0e16',
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#555',
            }}
          >
            git worktree add ~/.superagent/worktrees/{workspace.name}-{branch.name}{' '}
            {branch.is_local ? branch.name : `origin/${branch.name}`}
          </div>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={onCancelConfirm}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: '1px solid #2a2a3e',
                fontSize: '11px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                background: 'transparent',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirmCreate}
              style={{
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                background: 'var(--accent)',
                color: 'white',
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorktreeItem({
  worktree,
  onOpen,
  showPath,
}: {
  worktree: { name: string; path: string };
  onOpen: () => void;
  showPath?: boolean;
}) {
  return (
    <div className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px] cursor-pointer hover:bg-[rgba(59,130,246,0.06)]">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#555" strokeWidth="1.5">
        <rect x="3" y="3" width="10" height="10" rx="2" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{worktree.name}</div>
        {showPath && (
          <div
            style={{
              fontSize: '10px',
              color: '#333',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {worktree.path}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        style={{
          marginLeft: 'auto',
          fontSize: '11px',
          color: '#22c55e',
          background: 'rgba(34,197,94,0.08)',
          padding: '2px 8px',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Open
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && bun run test -- --run WorkspacePalette`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/WorkspacePalette.tsx apps/desktop/src/components/__tests__/WorkspacePalette.test.tsx
git commit -m "feat: add WorkspacePalette command palette with browse, create, and open flows"
```

---

## Task 6: Delete `CreateModal` and verify

**Files:**

- Delete: `apps/desktop/src/components/CreateModal.tsx`

- [ ] **Step 1: Delete the file**

```bash
trash apps/desktop/src/components/CreateModal.tsx
```

- [ ] **Step 2: Run all frontend tests**

Run: `cd apps/desktop && bun run test -- --run`
Expected: ALL PASS (no tests reference CreateModal directly)

- [ ] **Step 3: Run Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove CreateModal, replaced by WorkspacePalette"
```

---

## Verification

After all tasks are complete:

```bash
cd apps/desktop && bun run test -- --run
cd apps/desktop/src-tauri && cargo test
```

Both must pass with zero failures.
