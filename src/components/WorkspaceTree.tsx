import {
  Button,
  Tree,
  TreeItem,
  TreeItemContent,
} from 'react-aria-components';
import { useWorkspaceStore } from '../stores/workspace-store';
import type { Workspace } from '../stores/workspace-store';
import type { BranchInfo, WorktreeInfo } from '../lib/git';
import type { Selection, Key } from 'react-aria-components';

function BranchRow({ branch }: { branch: BranchInfo }) {
  return (
    <div className="flex items-center h-7 pl-4 pr-2 gap-1">
      <span style={{ color: 'var(--branch-icon)' }}>&#x2387;</span>
      <span
        className="text-text-primary truncate flex-1"
        style={{ fontSize: '13px' }}
      >
        {branch.name}
      </span>
      <span className="flex gap-1" style={{ fontSize: '11px' }}>
        {branch.ahead > 0 && (
          <span style={{ color: 'var(--git-ahead)' }}>+{branch.ahead}</span>
        )}
        {branch.behind > 0 && (
          <span style={{ color: 'var(--git-behind)' }}>-{branch.behind}</span>
        )}
      </span>
    </div>
  );
}

function WorktreeRow({ worktree }: { worktree: WorktreeInfo }) {
  return (
    <div className="flex items-center h-7 pl-4 pr-2 gap-1">
      <span style={{ color: 'var(--worktree-icon)' }}>&#x25C6;</span>
      <span
        className="text-text-primary truncate flex-1"
        style={{ fontSize: '13px' }}
      >
        {worktree.name}
      </span>
    </div>
  );
}

function RepoHeader({ workspace }: { workspace: Workspace }) {
  const headBranch = workspace.branches.find((b) => b.is_head);
  return (
    <div className="flex flex-col justify-center h-7 pl-2 pr-2">
      <div className="flex items-center gap-1">
        <Button
          slot="chevron"
          className="text-text-muted bg-transparent border-none p-0 outline-none cursor-pointer"
          style={{ fontSize: '11px', width: '12px', textAlign: 'center' }}
        >
          {workspace.expanded ? '\u25BE' : '\u25B8'}
        </Button>
        <span
          className="text-text-primary font-semibold truncate"
          style={{ fontSize: '13px' }}
        >
          {workspace.name}
        </span>
      </div>
      {headBranch && (
        <span
          className="text-text-muted truncate pl-5"
          style={{ fontSize: '11px', lineHeight: '1.3' }}
        >
          {headBranch.name}
        </span>
      )}
    </div>
  );
}

export function WorkspaceTree() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedItemId = useWorkspaceStore((s) => s.selectedItemId);
  const setSelectedItem = useWorkspaceStore((s) => s.setSelectedItem);
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded);

  const expandedKeys = new Set<Key>(
    workspaces.filter((ws) => ws.expanded).map((ws) => ws.id),
  );

  const selectedKeys: Selection = selectedItemId
    ? new Set([selectedItemId])
    : new Set<Key>();

  function handleSelectionChange(keys: Selection) {
    if (keys === 'all') return;
    const selected = [...keys][0];
    setSelectedItem(selected ? String(selected) : null);
  }

  function handleExpandedChange(keys: Set<Key>) {
    // Sync expanded state with store
    for (const ws of workspaces) {
      const shouldBeExpanded = keys.has(ws.id);
      if (ws.expanded !== shouldBeExpanded) {
        toggleExpanded(ws.id);
      }
    }
  }

  return (
    <Tree
      aria-label="Workspaces"
      selectionMode="single"
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}
      expandedKeys={expandedKeys}
      onExpandedChange={handleExpandedChange}
    >
      {workspaces.map((ws) => (
        <TreeItem
          key={ws.id}
          id={ws.id}
          textValue={ws.name}
          hasChildItems={
            ws.branches.length > 0 || ws.worktrees.length > 0
          }
          className={({ isSelected }) =>
            `outline-none ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
          }
        >
          <TreeItemContent>
            <RepoHeader workspace={ws} />
          </TreeItemContent>
          {ws.branches.map((b) => (
            <TreeItem
              key={`${ws.id}-branch-${b.name}`}
              id={`${ws.id}-branch-${b.name}`}
              textValue={b.name}
              className={({ isSelected }) =>
                `outline-none ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
              }
            >
              <TreeItemContent>
                <BranchRow branch={b} />
              </TreeItemContent>
            </TreeItem>
          ))}
          {ws.worktrees.map((wt) => (
            <TreeItem
              key={`${ws.id}-wt-${wt.name}`}
              id={`${ws.id}-wt-${wt.name}`}
              textValue={wt.name}
              className={({ isSelected }) =>
                `outline-none ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
              }
            >
              <TreeItemContent>
                <WorktreeRow worktree={wt} />
              </TreeItemContent>
            </TreeItem>
          ))}
          <TreeItem
            key={`${ws.id}-new-branch`}
            id={`${ws.id}-new-branch`}
            textValue="New Branch"
            className="outline-none"
          >
            <TreeItemContent>
              <div className="h-7 flex items-center pl-4">
                <button
                  className="text-text-muted hover:text-[var(--accent)] cursor-pointer"
                  style={{ fontSize: '13px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    /* Will trigger modal -- wired in Plan 03 */
                  }}
                >
                  + New Branch
                </button>
              </div>
            </TreeItemContent>
          </TreeItem>
        </TreeItem>
      ))}
    </Tree>
  );
}
