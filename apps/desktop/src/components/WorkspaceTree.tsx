import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Tree, TreeItem, TreeItemContent } from 'react-aria-components';
import type { Selection, Key } from 'react-aria-components';
import { createPortal } from 'react-dom';

import { useWorkspaces, useAgents, useTabs, useUiState } from '../hooks/useCollections';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectWorkspaceItem,
  closeProject,
  getWorkspaceItemIds,
} from '../lib/workspace-actions';
import { CloseProjectModal } from './CloseProjectModal';
import { StatusDot } from './StatusDot';

import type { BranchInfo, WorktreeInfo } from '../lib/git';
import type { DotStatus } from './StatusDot';
import type { Workspace } from '@superagent/db';

function BranchRow({ branch, agentStatus }: { branch: BranchInfo; agentStatus?: DotStatus }) {
  return (
    <div className="flex items-center gap-[6px] py-[4px] px-[10px] rounded-[5px]"
      style={{ marginLeft: '39px', marginRight: '6px', marginTop: '1px', marginBottom: '1px',
        background: branch.is_head ? 'rgba(59,130,246,0.1)' : undefined }}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
        stroke={branch.is_head ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="2">
        <circle cx="8" cy="8" r="3"/>
      </svg>
      <span style={{ fontSize: '13px', fontWeight: branch.is_head ? 500 : 400,
        color: branch.is_head ? 'var(--text-primary)' : 'var(--text-muted)', flex: 1 }}
        className="truncate">
        {branch.name}
      </span>
      {branch.is_head && (
        <span style={{ fontSize: '9px', color: 'var(--accent)', background: 'rgba(59,130,246,0.1)', padding: '1px 5px', borderRadius: '3px' }}>HEAD</span>
      )}
      {agentStatus && agentStatus !== 'idle' && (
        <StatusDot status={agentStatus} size={6} />
      )}
      <span className="flex gap-1" style={{ fontSize: '11px' }}>
        {branch.ahead > 0 && <span style={{ color: 'var(--git-ahead)' }}>+{branch.ahead}</span>}
        {branch.behind > 0 && <span style={{ color: 'var(--git-behind)' }}>-{branch.behind}</span>}
      </span>
    </div>
  );
}

function WorktreeRow({
  worktree,
  agentStatus,
}: {
  worktree: WorktreeInfo;
  agentStatus?: DotStatus;
}) {
  return (
    <div className="flex items-center gap-[6px] py-[4px] px-[10px] rounded-[5px]"
      style={{ marginLeft: '39px', marginRight: '6px', marginTop: '1px', marginBottom: '1px' }}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
        <rect x="3" y="3" width="10" height="10" rx="2"/>
      </svg>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)', flex: 1 }} className="truncate">
        {worktree.name}
      </span>
      {agentStatus && agentStatus !== 'idle' && (
        <StatusDot status={agentStatus} size={6} />
      )}
    </div>
  );
}

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
        background: isSelected ? 'rgba(59,130,246,0.04)' : undefined,
      }}
    >
      <Button
        slot="chevron"
        className="text-[var(--text-muted)] bg-transparent border-none p-0 outline-none cursor-pointer"
        style={{ fontSize: '10px', width: '10px', textAlign: 'center' }}
      >
        {workspace.expanded ? (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4z"/></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>
        )}
      </Button>
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'}
        strokeWidth="1.5"
        style={isSelected ? { filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.4))' } : undefined}
      >
        <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"/>
      </svg>
      <span
        className="font-medium truncate"
        style={{ fontSize: '13px', flex: 1, color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        {workspace.name}
      </span>
      {/* Collapsed: show inline branch + count */}
      {!workspace.expanded && (
        <>
          <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>·</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{headBranch?.name ?? 'main'}</span>
          {agentSummary && agentSummary.length > 0 && (
            <span className="flex items-center" style={{ gap: '3px', marginLeft: '4px' }}>
              {agentSummary.slice(0, 3).map((status, i) => (
                <StatusDot key={i} status={status} size={5} />
              ))}
            </span>
          )}
          {childCount > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '8px' }}>
              {childCount}
            </span>
          )}
        </>
      )}
      {/* Hover-reveal + button */}
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ width: '20px', height: '20px', borderRadius: '4px', background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        onClick={onPlusClick}
        role="button"
        aria-label="Add workspace"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onPlusClick(e as unknown as React.MouseEvent); }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M8 3v10M3 8h10"/></svg>
      </div>
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
      if (agent?.status === 'waiting') {
        best = 'waiting';
        break;
      }
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

  const itemIds = getWorkspaceItemIds(ws);

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
  const navigate = useNavigate();

  const expandedKeys = new Set<Key>(workspaces.filter((ws) => ws.expanded).map((ws) => ws.id));

  const selectedKeys: Selection = selectedItemId ? new Set([selectedItemId]) : new Set<Key>();

  const handleSelectionChange = useCallback(
    (keys: Selection) => {
      if (keys === 'all') return;
      const selected = [...keys][0];
      if (!selected) {
        selectWorkspaceItem(null, navigate);
        return;
      }
      selectWorkspaceItem(String(selected), navigate);
    },
    [navigate],
  );

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
    <div style={{ padding: '4px 12px 6px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
      Projects
    </div>
    <Tree
      aria-label="Workspaces"
      selectionMode="single"
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}
      expandedKeys={expandedKeys}
      onExpandedChange={handleExpandedChange}
    >
      {workspaces.map((ws) => (
        <RepoTreeItem key={ws.id} ws={ws} agentMap={agentMap} setModalWorkspace={setModalWorkspace} onRequestClose={setCloseTarget} selectedItemId={selectedItemId} />
      ))}
    </Tree>
    {closeTarget && (
      <CloseProjectModal
        isOpen={!!closeTarget}
        onClose={() => setCloseTarget(null)}
        onConfirm={async () => {
          await closeProject(closeTarget.id, navigate);
          setCloseTarget(null);
        }}
        projectName={closeTarget.name}
      />
    )}
    </>
  );
}

function ContextMenu({
  x,
  y,
  onClose,
  onCloseProject,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCloseProject: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-40"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] py-1 shadow-lg"
        style={{ left: x, top: y }}
        role="menu"
      >
        <button
          ref={buttonRef}
          role="menuitem"
          className="w-full cursor-pointer px-3 py-1.5 text-left text-[13px] text-[var(--destructive)] outline-none hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)]"
          onClick={(e) => {
            e.stopPropagation();
            onCloseProject();
          }}
        >
          Close Project
        </button>
      </div>
    </div>,
    document.body,
  );
}

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
  const agentSummary = useRepoAgentSummary(ws);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenuOpen(true);
  }

  return (
    <>
    <TreeItem
      key={ws.id}
      id={ws.id}
      textValue={ws.name}
      hasChildItems={ws.branches.length > 0 || ws.worktrees.length > 0}
      className="outline-none cursor-pointer"
    >
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
      {ws.branches.map((b) => (
        <TreeItem
          key={`${ws.id}-branch-${b.name}`}
          id={`${ws.id}-branch-${b.name}`}
          textValue={b.name}
          className={({ isSelected }) =>
            `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`
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
            `outline-none cursor-pointer ${isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`
          }
        >
          <TreeItemContent>
            <WorktreeRow worktree={wt} agentStatus={agentMap[`${ws.id}-wt-${wt.name}`]} />
          </TreeItemContent>
        </TreeItem>
      ))}
    </TreeItem>
    {menuOpen && <ContextMenu
      x={menuPos.current.x}
      y={menuPos.current.y}
      onClose={() => setMenuOpen(false)}
      onCloseProject={() => {
        setMenuOpen(false);
        onRequestClose(ws);
      }}
    />}
    </>
  );
}
