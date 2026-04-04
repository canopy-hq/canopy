import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Button, Tree, TreeItem, TreeItemContent } from 'react-aria-components';
import type { Selection, Key } from 'react-aria-components';
import { createPortal } from 'react-dom';

import { useNavigate } from '@tanstack/react-router';
import { Laptop, FolderGit2 } from 'lucide-react';

import { useWorkspaces, useAgents, useTabs, useUiState } from '../hooks/useCollections';
import { usePageVisible } from '../hooks/usePageVisible';
import { useWorkspacePolling } from '../hooks/useWorkspacePolling';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectWorkspaceItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  renameWorktree,
} from '../lib/workspace-actions';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { StatusDot } from './StatusDot';
import { WorkspacePalette } from './WorkspacePalette';

import type { BranchInfo, WorktreeInfo, DiffStat } from '../lib/git';
import type { DotStatus } from './StatusDot';
import type { Workspace } from '@superagent/db';

const DiffPill = memo(function DiffPill({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 gap-1 rounded bg-white/5 px-1.5 py-px text-[11px] font-medium whitespace-nowrap">
      {additions > 0 && (
        <span className="tabular-nums" style={{ color: 'var(--git-ahead)' }}>
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="tabular-nums" style={{ color: 'var(--git-behind)' }}>
          &minus;{deletions}
        </span>
      )}
    </span>
  );
});

const IconWithBadge = memo(function IconWithBadge({
  children,
  agentStatus,
}: {
  children: React.ReactNode;
  agentStatus?: DotStatus;
}) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Force SVG to display:block to eliminate inline baseline offset */}
      <div style={{ display: 'block', lineHeight: 0, fontSize: 0 }}>{children}</div>
      {agentStatus && agentStatus !== 'idle' && (
        <div style={{ position: 'absolute', top: -2, right: -2, lineHeight: 0 }}>
          <StatusDot status={agentStatus} size={6} />
        </div>
      )}
    </div>
  );
});

const BranchRow = memo(
  function BranchRow({
    branch,
    agentStatus,
    diffStat,
  }: {
    branch: BranchInfo;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
  }) {
    return (
      <div className="my-px mr-1.5 ml-[39px] flex items-center gap-[6px] rounded-[5px] py-[3px] pl-[10px]">
        <IconWithBadge agentStatus={agentStatus}>
          <Laptop
            size={14}
            strokeWidth={1.5}
            stroke={branch.is_head ? 'var(--accent)' : 'var(--text-muted)'}
          />
        </IconWithBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px]">
            <span
              className={`min-w-0 flex-1 truncate text-[13px] ${branch.is_head ? 'font-medium text-text-primary' : 'font-normal text-text-secondary'}`}
            >
              {branch.name}
            </span>
            {diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
          </div>
          {branch.is_head && (
            <span className="mt-0.5 block truncate text-[11px] text-text-muted">local</span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.branch.name === next.branch.name &&
    prev.branch.is_head === next.branch.is_head &&
    prev.agentStatus === next.agentStatus &&
    prev.diffStat?.additions === next.diffStat?.additions &&
    prev.diffStat?.deletions === next.diffStat?.deletions,
);

const WorktreeRow = memo(
  function WorktreeRow({
    worktree,
    workspaceId,
    agentStatus,
    diffStat,
  }: {
    worktree: WorktreeInfo & { label?: string };
    workspaceId: string;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
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
      <div className="group/wt my-px mr-1.5 ml-[39px] flex items-center gap-[6px] rounded-[5px] py-[3px] pl-[10px]">
        <IconWithBadge agentStatus={agentStatus}>
          <FolderGit2 size={14} strokeWidth={1.5} stroke="var(--text-muted)" />
        </IconWithBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px]">
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
                className="m-0 w-full border-none bg-transparent p-0 text-sm text-[var(--text-secondary)] outline-none"
              />
            ) : (
              <span
                className="block min-w-0 flex-1 truncate text-sm text-text-secondary"
                onDoubleClick={startEditing}
              >
                {displayName}
              </span>
            )}
            {diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-text-muted">
            {worktree.branch || worktree.name}
          </span>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.worktree.name === next.worktree.name &&
    prev.worktree.branch === next.worktree.branch &&
    prev.worktree.label === next.worktree.label &&
    prev.workspaceId === next.workspaceId &&
    prev.agentStatus === next.agentStatus &&
    prev.diffStat?.additions === next.diffStat?.additions &&
    prev.diffStat?.deletions === next.diffStat?.deletions,
);

const RepoHeader = memo(
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
        className={`group flex cursor-pointer items-center gap-[7px] border-l-[3px] py-[6px] pr-[6px] pl-[12px] ${isSelected ? 'border-accent bg-[rgba(59,130,246,0.04)]' : 'border-transparent'}`}
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
          className={`flex-shrink-0 ${isSelected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.4)]' : ''}`}
        >
          <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
        </svg>
        <span
          className={`flex-1 truncate text-sm font-medium ${isSelected ? 'text-text-primary' : 'text-text-muted'}`}
        >
          {workspace.name}
        </span>
        {/* Always show agent dots when expanded */}
        {workspace.expanded && agentSummary && agentSummary.length > 0 && (
          <span className="ml-1 flex items-center gap-[3px]">
            {agentSummary.slice(0, 3).map((status, i) => (
              <StatusDot key={i} status={status} size={5} />
            ))}
          </span>
        )}
        {/* Always show branch/worktree count */}
        {childCount > 0 && (
          <span className="rounded-lg bg-bg-tertiary px-[6px] py-px font-mono text-[11px] text-text-muted tabular-nums">
            {childCount}
          </span>
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
  },
  (prev, next) =>
    prev.workspace.id === next.workspace.id &&
    prev.workspace.name === next.workspace.name &&
    prev.workspace.expanded === next.workspace.expanded &&
    prev.workspace.branches.length === next.workspace.branches.length &&
    prev.workspace.worktrees.length === next.workspace.worktrees.length &&
    prev.isSelected === next.isSelected &&
    prev.onPlusClick === next.onPlusClick &&
    prev.onRowClick === next.onRowClick &&
    prev.agentSummary?.length === next.agentSummary?.length &&
    (prev.agentSummary ?? []).every((s, i) => s === next.agentSummary?.[i]),
);

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
 * Derives from the already-computed agentMap to avoid re-scanning all tabs/agents.
 */
function getRepoAgentSummary(
  ws: Workspace,
  agentMap: Record<string, DotStatus>,
): Array<'running' | 'waiting'> {
  const statuses: Array<'running' | 'waiting'> = [];
  const checkId = (id: string) => {
    const s = agentMap[id];
    if (s === 'running' || s === 'waiting') statuses.push(s);
  };
  checkId(ws.id);
  for (const b of ws.branches) checkId(`${ws.id}-branch-${b.name}`);
  for (const wt of ws.worktrees) checkId(`${ws.id}-wt-${wt.name}`);
  statuses.sort((a, b) =>
    a === 'waiting' && b !== 'waiting' ? -1 : a !== 'waiting' && b === 'waiting' ? 1 : 0,
  );
  return statuses;
}

export function WorkspaceTree() {
  const workspaces = useWorkspaces();
  const { selectedItemId, sidebarVisible } = useUiState();
  const [modalWorkspace, setModalWorkspace] = useState<Workspace | null>(null);
  const [closeTarget, setCloseTarget] = useState<Workspace | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{
    workspaceId: string;
    name: string;
  } | null>(null);
  const agentMap = useWorkspaceAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useWorkspacePolling(workspaces, sidebarVisible && pageVisible);
  const navigate = useNavigate();

  const expandedKeys = useMemo(
    () => new Set<Key>(workspaces.filter((ws) => ws.expanded).map((ws) => ws.id)),
    [workspaces],
  );

  const selectedKeys = useMemo<Selection>(() => {
    if (!selectedItemId) return new Set<Key>();
    if (!selectedItemId.includes('-branch-') && !selectedItemId.includes('-wt-'))
      return new Set<Key>();
    return new Set([selectedItemId]);
  }, [selectedItemId]);

  const handleSelectionChange = useCallback(
    (keys: Selection) => {
      if (keys === 'all') return;
      const selected = [...keys][0];
      if (!selected) return; // no deselect
      const key = String(selected);
      if (!key.includes('-branch-') && !key.includes('-wt-')) return; // workspace rows not selectable
      selectWorkspaceItem(key, navigate);
    },
    [navigate],
  );

  const handleExpandedChange = useCallback(
    (keys: Set<Key>) => {
      for (const ws of workspaces) {
        const shouldBeExpanded = keys.has(ws.id);
        if (ws.expanded !== shouldBeExpanded) {
          toggleExpanded(ws.id);
        }
      }
    },
    [workspaces],
  );

  return (
    <>
      <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-[1px] text-text-muted uppercase">
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
            diffStats={diffStatsMap[ws.id]}
            setModalWorkspace={setModalWorkspace}
            onRequestClose={setCloseTarget}
            onRequestRemoveWt={(name) => setRemoveWtTarget({ workspaceId: ws.id, name })}
            selectedItemId={selectedItemId}
          />
        ))}
      </Tree>
      {closeTarget && (
        <CloseProjectModal
          isOpen
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
          isOpen
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
          isOpen
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
  items,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: Array<{ label: string; onSelect: () => void; destructive?: boolean }>;
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
        if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] py-1 shadow-lg"
        style={{ left: x, top: y }}
        role="menu"
        onKeyDown={(e) => {
          const menuItems =
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
          const current = document.activeElement as HTMLElement;
          const idx = Array.from(menuItems).indexOf(current as HTMLButtonElement);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            menuItems[(idx + 1) % menuItems.length]?.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            menuItems[(idx - 1 + menuItems.length) % menuItems.length]?.focus();
          } else if (e.key === 'Home') {
            e.preventDefault();
            menuItems[0]?.focus();
          } else if (e.key === 'End') {
            e.preventDefault();
            menuItems[menuItems.length - 1]?.focus();
          }
        }}
      >
        {items.map((item, i) => (
          <button
            key={item.label}
            ref={i === 0 ? buttonRef : undefined}
            role="menuitem"
            tabIndex={i === 0 ? 0 : -1}
            className={`w-full cursor-pointer px-3 py-1.5 text-left text-[13px] outline-none hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)] ${item.destructive ? 'text-[var(--destructive)]' : 'text-[var(--text-secondary)]'}`}
            onClick={(e) => {
              e.stopPropagation();
              item.onSelect();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.onSelect();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function RepoTreeItem({
  ws,
  agentMap,
  diffStats,
  setModalWorkspace,
  onRequestClose,
  onRequestRemoveWt,
  selectedItemId,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  setModalWorkspace: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  onRequestRemoveWt: (name: string) => void;
  selectedItemId: string | null;
}) {
  const agentSummary = useMemo(() => getRepoAgentSummary(ws, agentMap), [ws, agentMap]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });
  const [wtMenuTarget, setWtMenuTarget] = useState<string | null>(null);
  const wtMenuPos = useRef({ x: 0, y: 0 });

  const handlePlusClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setModalWorkspace(ws);
    },
    [ws, setModalWorkspace],
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleExpanded(ws.id);
    },
    [ws.id],
  );

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
              onPlusClick={handlePlusClick}
              onRowClick={handleRowClick}
            />
          </div>
        </TreeItemContent>
        {ws.branches.map((b) => (
          <TreeItem
            key={`${ws.id}-branch-${b.name}`}
            id={`${ws.id}-branch-${b.name}`}
            textValue={b.name}
            className="cursor-pointer outline-none hover:bg-bg-tertiary data-[selected]:bg-[rgba(59,130,246,0.08)]"
          >
            <TreeItemContent>
              <BranchRow
                branch={b}
                agentStatus={agentMap[`${ws.id}-branch-${b.name}`]}
                diffStat={diffStats?.[b.name]}
              />
            </TreeItemContent>
          </TreeItem>
        ))}
        {ws.worktrees.map((wt) => (
          <TreeItem
            key={`${ws.id}-wt-${wt.name}`}
            id={`${ws.id}-wt-${wt.name}`}
            textValue={wt.name}
            className="cursor-pointer outline-none hover:bg-bg-tertiary data-[selected]:bg-[rgba(59,130,246,0.08)]"
          >
            <TreeItemContent>
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  wtMenuPos.current = { x: e.clientX, y: e.clientY };
                  setWtMenuTarget(wt.name);
                }}
              >
                <WorktreeRow
                  worktree={wt}
                  workspaceId={ws.id}
                  agentStatus={agentMap[`${ws.id}-wt-${wt.name}`]}
                  diffStat={diffStats?.[wt.branch]}
                />
              </div>
            </TreeItemContent>
          </TreeItem>
        ))}
      </TreeItem>
      {menuOpen && (
        <ContextMenu
          x={menuPos.current.x}
          y={menuPos.current.y}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: 'Close Project',
              destructive: true,
              onSelect: () => {
                setMenuOpen(false);
                onRequestClose(ws);
              },
            },
          ]}
        />
      )}
      {wtMenuTarget && (
        <ContextMenu
          x={wtMenuPos.current.x}
          y={wtMenuPos.current.y}
          onClose={() => setWtMenuTarget(null)}
          items={[
            {
              label: 'Close Worktree',
              destructive: true,
              onSelect: () => {
                const name = wtMenuTarget;
                setWtMenuTarget(null);
                onRequestRemoveWt(name);
              },
            },
          ]}
        />
      )}
    </>
  );
}
