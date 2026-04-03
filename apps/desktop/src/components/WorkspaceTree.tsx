import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Tree, TreeItem, TreeItemContent } from 'react-aria-components';
import type { Selection, Key } from 'react-aria-components';
import { createPortal } from 'react-dom';

import { useNavigate } from '@tanstack/react-router';

import { useWorkspaces, useAgents, useTabs, useUiState } from '../hooks/useCollections';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectWorkspaceItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  renameWorktree,
  getWorkspaceItemIds,
} from '../lib/workspace-actions';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { StatusDot } from './StatusDot';
import { WorkspacePalette } from './WorkspacePalette';

import type { BranchInfo, WorktreeInfo } from '../lib/git';
import type { DotStatus } from './StatusDot';
import type { Workspace } from '@superagent/db';

function BranchRow({ branch, agentStatus }: { branch: BranchInfo; agentStatus?: DotStatus }) {
  return (
    <div
      className="flex items-center gap-[6px] rounded-[5px] px-[10px] py-[4px]"
      style={{ marginLeft: '39px', marginRight: '6px', marginTop: '1px', marginBottom: '1px' }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke={branch.is_head ? 'var(--accent)' : 'var(--text-muted)'}
        strokeWidth="2"
      >
        <circle cx="8" cy="8" r="3" />
      </svg>
      <span
        style={{
          fontSize: '13px',
          fontWeight: branch.is_head ? 500 : 400,
          color: branch.is_head ? 'var(--text-primary)' : 'var(--text-secondary)',
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

function WorktreeRow({
  worktree,
  workspaceId,
  agentStatus,
  onRemoveClick,
}: {
  worktree: WorktreeInfo & { label?: string };
  workspaceId: string;
  agentStatus?: DotStatus;
  onRemoveClick: (e: React.MouseEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = worktree.label || worktree.branch || worktree.name;

  function startEditing() {
    setEditValue(displayName);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    // If cleared or same as branch, remove custom label
    const newLabel =
      trimmed && trimmed !== worktree.branch && trimmed !== worktree.name ? trimmed : '';
    renameWorktree(workspaceId, worktree.name, newLabel);
    setEditing(false);
  }

  return (
    <div
      className="group/wt flex items-center gap-[6px] rounded-[5px] px-[10px] py-[3px]"
      style={{ marginLeft: '39px', marginRight: '6px', marginTop: '1px', marginBottom: '1px' }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        className="mt-[1px] flex-shrink-0"
      >
        <rect x="3" y="3" width="10" height="10" rx="2" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              e.stopPropagation(); // prevent Tree from capturing space/arrows
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full border-none bg-transparent text-[var(--text-secondary)] outline-none"
            style={{ fontSize: '14px', padding: 0, margin: 0 }}
          />
        ) : (
          <span
            style={{ fontSize: '14px', color: 'var(--text-secondary)', display: 'block' }}
            className="truncate"
            onDoubleClick={startEditing}
          >
            {displayName}
          </span>
        )}
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            display: 'block',
            marginTop: '2px',
          }}
          className="truncate"
        >
          {worktree.branch || worktree.name}
        </span>
      </div>
      {agentStatus && agentStatus !== 'idle' && <StatusDot status={agentStatus} size={6} />}
      <div
        className="flex-shrink-0 cursor-pointer opacity-0 group-hover/wt:opacity-100"
        onClick={onRemoveClick}
        role="button"
        aria-label={`Remove worktree ${worktree.name}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRemoveClick(e as unknown as React.MouseEvent);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.5"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </div>
    </div>
  );
}

function RepoHeader({
  workspace,
  agentSummary,
  isSelected,
  onPlusClick,
  onRowClick,
}: {
  workspace: Workspace;
  agentSummary?: Array<'running' | 'waiting'>;
  isSelected: boolean;
  onPlusClick: (e: React.MouseEvent) => void;
  onRowClick: (e: React.MouseEvent) => void;
}) {
  const childCount = workspace.branches.length + workspace.worktrees.length;

  return (
    <div
      className="group flex cursor-pointer items-center gap-[7px] py-[6px] pr-[6px] pl-[12px]"
      style={{
        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
        background: isSelected ? 'rgba(59,130,246,0.04)' : undefined,
      }}
      onClick={onRowClick}
    >
      {/* Hidden chevron for React ARIA Tree expand/collapse */}
      <Button slot="chevron" className="hidden" />
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'}
        strokeWidth="1.5"
        className="flex-shrink-0"
        style={isSelected ? { filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.4))' } : undefined}
      >
        <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
      </svg>
      <span
        className="truncate font-medium"
        style={{
          fontSize: '14px',
          flex: 1,
          color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {workspace.name}
      </span>
      {/* Collapsed: show inline branch + count */}
      {!workspace.expanded && (
        <>
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
                fontSize: '11px',
                color: 'var(--text-muted)',
                background: 'var(--bg-tertiary)',
                padding: '1px 6px',
                borderRadius: '8px',
              }}
            >
              {childCount}
            </span>
          )}
        </>
      )}
      {/* Collapse/expand chevron indicator */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="var(--text-muted)"
        className="flex-shrink-0"
      >
        {workspace.expanded ? <path d="M4 6l4 4 4-4z" /> : <path d="M6 4l4 4-4 4z" />}
      </svg>
      {/* + button */}
      <div
        className="flex-shrink-0 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onPlusClick(e);
        }}
        role="button"
        aria-label="Add workspace"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            onPlusClick(e as unknown as React.MouseEvent);
          }
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.5"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
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

  return useMemo(() => {
    const agentByPty = new Map(agents.map((a) => [a.ptyId, a]));
    const result: Record<string, DotStatus> = {};
    for (const tab of tabs) {
      const ptyIds = collectLeafPtyIds(tab.paneRoot);
      let best: DotStatus = 'idle';
      for (const id of ptyIds) {
        const agent = agentByPty.get(id);
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
  }, [agents, tabs]);
}

/**
 * Build summary dots for a collapsed repo: collect all non-idle agent statuses
 * from workspace items that belong to this workspace, sorted waiting-first.
 */
function useRepoAgentSummary(ws: Workspace): Array<'running' | 'waiting'> {
  const agents = useAgents();
  const tabs = useTabs();

  return useMemo(() => {
    const itemIds = getWorkspaceItemIds(ws);
    const agentByPty = new Map(agents.map((a) => [a.ptyId, a]));
    const statuses: Array<'running' | 'waiting'> = [];
    for (const tab of tabs) {
      if (!itemIds.has(tab.workspaceItemId)) continue;
      for (const id of collectLeafPtyIds(tab.paneRoot)) {
        const agent = agentByPty.get(id);
        if (agent?.status === 'running' || agent?.status === 'waiting') {
          statuses.push(agent.status);
        }
      }
    }
    statuses.sort((a, b) =>
      a === 'waiting' && b !== 'waiting' ? -1 : a !== 'waiting' && b === 'waiting' ? 1 : 0,
    );
    return statuses;
  }, [agents, tabs, ws]);
}

export function WorkspaceTree() {
  const workspaces = useWorkspaces();
  const { selectedItemId } = useUiState();
  const [modalWorkspace, setModalWorkspace] = useState<Workspace | null>(null);
  const [closeTarget, setCloseTarget] = useState<Workspace | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{
    workspaceId: string;
    name: string;
  } | null>(null);
  const agentMap = useWorkspaceAgentMap();
  const navigate = useNavigate();

  const expandedKeys = useMemo(
    () => new Set<Key>(workspaces.filter((ws) => ws.expanded).map((ws) => ws.id)),
    [workspaces],
  );

  const selectedKeys = useMemo<Selection>(
    () => (selectedItemId ? new Set([selectedItemId]) : new Set<Key>()),
    [selectedItemId],
  );

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
      <div
        style={{
          padding: '4px 12px 6px',
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-muted)',
        }}
      >
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
          <RepoTreeItem
            key={ws.id}
            ws={ws}
            agentMap={agentMap}
            setModalWorkspace={setModalWorkspace}
            onRequestClose={setCloseTarget}
            onRequestRemoveWt={(name) => setRemoveWtTarget({ workspaceId: ws.id, name })}
            selectedItemId={selectedItemId}
          />
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
      {removeWtTarget && (
        <RemoveWorktreeModal
          isOpen={!!removeWtTarget}
          onClose={() => setRemoveWtTarget(null)}
          worktreeName={removeWtTarget.name}
          onConfirm={async (alsoDeleteGit) => {
            if (alsoDeleteGit) {
              await removeWorktree(removeWtTarget.workspaceId, removeWtTarget.name);
            }
            hideWorktree(removeWtTarget.workspaceId, removeWtTarget.name);
            setRemoveWtTarget(null);
          }}
        />
      )}
      {modalWorkspace && (
        <WorkspacePalette
          isOpen={!!modalWorkspace}
          onClose={() => setModalWorkspace(null)}
          workspace={modalWorkspace}
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
  onRequestRemoveWt,
  selectedItemId,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  setModalWorkspace: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  onRequestRemoveWt: (name: string) => void;
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
        className="cursor-pointer outline-none"
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
              onRowClick={(e) => {
                e.stopPropagation();
                toggleExpanded(ws.id);
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
              `cursor-pointer outline-none ${isSelected ? 'bg-[rgba(59,130,246,0.08)]' : 'hover:bg-bg-tertiary'}`
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
              `cursor-pointer outline-none ${isSelected ? 'bg-[rgba(59,130,246,0.08)]' : 'hover:bg-bg-tertiary'}`
            }
          >
            <TreeItemContent>
              <WorktreeRow
                worktree={wt}
                workspaceId={ws.id}
                agentStatus={agentMap[`${ws.id}-wt-${wt.name}`]}
                onRemoveClick={(e) => {
                  e.stopPropagation();
                  onRequestRemoveWt(wt.name);
                }}
              />
            </TreeItemContent>
          </TreeItem>
        ))}
      </TreeItem>
      {menuOpen && (
        <ContextMenu
          x={menuPos.current.x}
          y={menuPos.current.y}
          onClose={() => setMenuOpen(false)}
          onCloseProject={() => {
            setMenuOpen(false);
            onRequestClose(ws);
          }}
        />
      )}
    </>
  );
}
