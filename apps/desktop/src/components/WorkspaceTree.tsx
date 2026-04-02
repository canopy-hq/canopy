import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Tree,
  TreeItem,
  TreeItemContent,
} from 'react-aria-components';
import { useWorkspaces, useAgents, useTabs, useUiState } from '../hooks/useCollections';
import { toggleExpanded, selectWorkspaceItem, closeProject } from '../lib/workspace-actions';
import { StatusDot } from './StatusDot';
import type { DotStatus } from './StatusDot';
import type { Workspace } from '@superagent/db';
import type { BranchInfo, WorktreeInfo } from '../lib/git';
import type { Selection, Key } from 'react-aria-components';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import { CreateModal } from './CreateModal';
import { CloseProjectModal } from './CloseProjectModal';

function BranchRow({ branch, agentStatus }: { branch: BranchInfo; agentStatus?: DotStatus }) {
  return (
    <div className="flex items-center h-7 pl-4 pr-2 gap-1">
      <span style={{ color: 'var(--branch-icon)' }}>&#x2387;</span>
      <span
        className="text-text-primary truncate flex-1"
        style={{ fontSize: '13px' }}
      >
        {branch.name}
      </span>
      {agentStatus && agentStatus !== 'idle' && <StatusDot status={agentStatus} size={8} />}
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

function WorktreeRow({ worktree, agentStatus }: { worktree: WorktreeInfo; agentStatus?: DotStatus }) {
  return (
    <div className="flex items-center h-7 pl-4 pr-2 gap-1">
      <span style={{ color: 'var(--worktree-icon)' }}>&#x25C6;</span>
      <span
        className="text-text-primary truncate flex-1"
        style={{ fontSize: '13px' }}
      >
        {worktree.name}
      </span>
      {agentStatus && agentStatus !== 'idle' && <StatusDot status={agentStatus} size={8} />}
    </div>
  );
}

function RepoHeader({ workspace, agentSummary }: { workspace: Workspace; agentSummary?: Array<'running' | 'waiting'> }) {
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
        {!workspace.expanded && agentSummary && agentSummary.length > 0 && (
          <span className="flex items-center" style={{ gap: '4px', marginLeft: '4px' }}>
            {agentSummary.slice(0, 3).map((status, i) => (
              <StatusDot key={i} status={status} size={6} />
            ))}
            {agentSummary.length > 3 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                +{agentSummary.length - 3}
              </span>
            )}
          </span>
        )}
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

/**
 * Compute a map of workspaceItemId -> best agent status by cross-referencing
 * tabs (which have workspaceItemId and pane trees with ptyIds) with the agent store.
 */
function useWorkspaceAgentMap(): Record<string, DotStatus> {
  const agents = useAgents();
  const tabs = useTabs();

  const result: Record<string, DotStatus> = {};
  for (const tab of tabs) {
    const ptyIds = collectLeafPtyIds(tab.paneRoot);
    let best: DotStatus = 'idle';
    for (const id of ptyIds) {
      const agent = agents.find((a) => a.ptyId === id);
      if (agent?.status === 'waiting') { best = 'waiting'; break; }
      if (agent?.status === 'running') best = 'running';
    }
    const existing = result[tab.workspaceItemId];
    if (best === 'waiting' || (best === 'running' && existing !== 'waiting')) {
      result[tab.workspaceItemId] = best;
    } else if (!existing) {
      result[tab.workspaceItemId] = best;
    }
  }
  return result;
}

/**
 * Build summary dots for a collapsed repo: collect all non-idle agent statuses
 * from workspace items that belong to this workspace, sorted waiting-first.
 */
function useRepoAgentSummary(ws: Workspace): Array<'running' | 'waiting'> {
  const agents = useAgents();
  const tabs = useTabs();

  const itemIds = new Set<string>();
  itemIds.add(ws.id);
  for (const b of ws.branches) itemIds.add(`${ws.id}-branch-${b.name}`);
  for (const wt of ws.worktrees) itemIds.add(`${ws.id}-wt-${wt.name}`);

  const statuses: Array<'running' | 'waiting'> = [];
  for (const tab of tabs) {
    if (!itemIds.has(tab.workspaceItemId)) continue;
    const ptyIds = collectLeafPtyIds(tab.paneRoot);
    for (const id of ptyIds) {
      const agent = agents.find((a) => a.ptyId === id);
      if (agent?.status === 'running' || agent?.status === 'waiting') {
        statuses.push(agent.status);
      }
    }
  }

  // Sort: waiting first, then running
  statuses.sort((a, b) => {
    if (a === 'waiting' && b !== 'waiting') return -1;
    if (a !== 'waiting' && b === 'waiting') return 1;
    return 0;
  });

  return statuses;
}

export function WorkspaceTree() {
  const workspaces = useWorkspaces();
  const { selectedItemId } = useUiState();
  const [modalWorkspace, setModalWorkspace] = useState<Workspace | null>(null);
  const [closeTarget, setCloseTarget] = useState<Workspace | null>(null);
  const agentMap = useWorkspaceAgentMap();

  const expandedKeys = new Set<Key>(
    workspaces.filter((ws) => ws.expanded).map((ws) => ws.id),
  );

  const selectedKeys: Selection = selectedItemId
    ? new Set([selectedItemId])
    : new Set<Key>();

  function findItemLabel(itemId: string): string {
    for (const ws of workspaces) {
      if (itemId === ws.id) return ws.name;
      if (itemId.startsWith(ws.id + '-branch-')) {
        return itemId.slice((ws.id + '-branch-').length);
      }
      if (itemId.startsWith(ws.id + '-wt-')) {
        return itemId.slice((ws.id + '-wt-').length);
      }
    }
    return 'Terminal';
  }

  function handleSelectionChange(keys: Selection) {
    if (keys === 'all') return;
    const selected = [...keys][0];
    if (!selected) {
      selectWorkspaceItem(null);
      return;
    }
    const selectedStr = String(selected);
    const label = findItemLabel(selectedStr);
    selectWorkspaceItem(selectedStr, label);
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
    <>
    <Tree
      aria-label="Workspaces"
      selectionMode="single"
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}
      expandedKeys={expandedKeys}
      onExpandedChange={handleExpandedChange}
    >
      {workspaces.map((ws) => (
        <RepoTreeItem key={ws.id} ws={ws} agentMap={agentMap} setModalWorkspace={setModalWorkspace} onRequestClose={setCloseTarget} />
      ))}
    </Tree>
    {modalWorkspace && (
      <CreateModal
        isOpen={!!modalWorkspace}
        onClose={() => setModalWorkspace(null)}
        workspace={modalWorkspace}
      />
    )}
    {closeTarget && (
      <CloseProjectModal
        isOpen={!!closeTarget}
        onClose={() => setCloseTarget(null)}
        onConfirm={async () => {
          await closeProject(closeTarget.id);
          setCloseTarget(null);
        }}
        projectName={closeTarget.name}
      />
    )}
    </>
  );
}

function RepoTreeItem({
  ws,
  agentMap,
  setModalWorkspace,
  onRequestClose,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  setModalWorkspace: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
}) {
  const agentSummary = useRepoAgentSummary(ws);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

  return (
    <>
    <TreeItem
      key={ws.id}
      id={ws.id}
      textValue={ws.name}
      hasChildItems={ws.branches.length > 0 || ws.worktrees.length > 0}
      className={({ isSelected }) =>
        `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
      }
    >
      <TreeItemContent>
        <div onContextMenu={handleContextMenu}>
          <RepoHeader workspace={ws} agentSummary={agentSummary} />
        </div>
      </TreeItemContent>
      {ws.branches.map((b) => (
        <TreeItem
          key={`${ws.id}-branch-${b.name}`}
          id={`${ws.id}-branch-${b.name}`}
          textValue={b.name}
          className={({ isSelected }) =>
            `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
          }
        >
          <TreeItemContent>
            <BranchRow branch={b} agentStatus={agentMap[`${ws.id}-branch-${b.name}`]} />
          </TreeItemContent>
        </TreeItem>
      ))}
      {ws.worktrees.map((wt) => (
        <TreeItem
          key={`${ws.id}-wt-${wt.name}`}
          id={`${ws.id}-wt-${wt.name}`}
          textValue={wt.name}
          className={({ isSelected }) =>
            `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary border-l-2 border-l-[var(--accent)]' : 'hover:bg-bg-tertiary'}`
          }
        >
          <TreeItemContent>
            <WorktreeRow worktree={wt} agentStatus={agentMap[`${ws.id}-wt-${wt.name}`]} />
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
                setModalWorkspace(ws);
              }}
            >
              + New Branch
            </button>
          </div>
        </TreeItemContent>
      </TreeItem>
    </TreeItem>
    {menuOpen && createPortal(
      <div
        className="fixed inset-0 z-40"
        onClick={() => setMenuOpen(false)}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen(false); }}
        role="presentation"
      >
        <div
          className="fixed z-50 min-w-[180px] py-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-[13px] text-[var(--destructive)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onRequestClose(ws);
            }}
          >
            Close Project
          </button>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}
