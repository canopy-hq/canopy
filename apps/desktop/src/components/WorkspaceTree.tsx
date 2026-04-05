import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';

import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getSetting } from '@superagent/db';
import { useNavigate } from '@tanstack/react-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ChevronDown, ChevronRight, GitPullRequest, Laptop, FolderGit2, Plus } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { makeWorkspacePaletteItem } from '../commands/workspace-commands';
import {
  useWorkspaces,
  useAgents,
  useTabs,
  useUiState,
  useSettings,
} from '../hooks/useCollections';
import { useDragStyle } from '../hooks/useDragStyle';
import { useDropping } from '../hooks/useDropping';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { usePageVisible } from '../hooks/usePageVisible';
import { usePrPolling } from '../hooks/usePrPolling';
import { useWorkspacePolling } from '../hooks/useWorkspacePolling';
import { restrictToVerticalAxis, sortableTransition, useDragSensors } from '../lib/dnd';
import { GITHUB_CONNECTION_KEY } from '../lib/github';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectWorkspaceItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  renameWorktree,
  reorderWorkspaces,
} from '../lib/workspace-actions';
import { openWorkspacePalette } from '../lib/workspace-palette-bridge';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { StatusDot } from './StatusDot';
import { Badge, Button, Tooltip } from './ui';

import type { BranchInfo, WorktreeInfo, DiffStat } from '../lib/git';
import type { PrInfo } from '../lib/github';
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
    <span className="inline-flex flex-shrink-0 gap-1.5 rounded bg-white/5 px-2 py-0.5 text-sm font-medium whitespace-nowrap">
      {additions > 0 && <span className="text-(--git-ahead) tabular-nums">+{additions}</span>}
      {deletions > 0 && (
        <span className="text-(--git-behind) tabular-nums">&minus;{deletions}</span>
      )}
    </span>
  );
});

const PR_BADGE_COLOR: Record<PrInfo['state'], 'success' | 'neutral' | 'merged'> = {
  OPEN: 'success',
  DRAFT: 'neutral',
  MERGED: 'merged',
  CLOSED: 'neutral',
};
const PR_BADGE_LABEL: Record<PrInfo['state'], string> = {
  OPEN: 'Open',
  DRAFT: 'Draft',
  MERGED: 'Merged',
  CLOSED: 'Closed',
};

const PrBadge = memo(function PrBadge({ pr }: { pr: PrInfo }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void openUrl(pr.url);
      }}
      className="cursor-pointer"
    >
      <Badge size="md" color={PR_BADGE_COLOR[pr.state]} className="gap-1.5 hover:brightness-125">
        <GitPullRequest size={14} strokeWidth={2} />#{pr.number} {PR_BADGE_LABEL[pr.state]}
      </Badge>
    </button>
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
    <div className="relative shrink-0">
      <div className="block text-[0px] leading-[0]">{children}</div>
      {agentStatus && agentStatus !== 'idle' && (
        <div className="absolute -top-0.5 -right-0.5 leading-[0]">
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
    prInfo,
  }: {
    branch: BranchInfo;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    prInfo?: PrInfo;
  }) {
    return (
      <div className="my-px mr-1.5 rounded-[5px] border-l-[3px] border-transparent py-0.75 pr-1.5 pl-3">
        <div className="flex items-center gap-1.5">
          <IconWithBadge agentStatus={agentStatus}>
            <Laptop
              size={14}
              strokeWidth={1.5}
              stroke={branch.is_head ? 'var(--accent)' : 'var(--text-muted)'}
            />
          </IconWithBadge>
          <span
            className={`min-w-0 flex-1 truncate font-mono text-base ${branch.is_head ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            {branch.name}
          </span>
          {diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
        </div>
        {(prInfo || branch.is_head) && (
          <div className="mt-0.5 flex items-center pl-[20px]">
            {branch.is_head && <span className="text-[11px] text-text-muted">local</span>}
            <span className="flex-1" />
            {prInfo && <PrBadge pr={prInfo} />}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.branch.name === next.branch.name &&
    prev.branch.is_head === next.branch.is_head &&
    prev.agentStatus === next.agentStatus &&
    prev.diffStat?.additions === next.diffStat?.additions &&
    prev.diffStat?.deletions === next.diffStat?.deletions &&
    prev.prInfo?.number === next.prInfo?.number &&
    prev.prInfo?.state === next.prInfo?.state,
);

const WorktreeRow = memo(
  function WorktreeRow({
    worktree,
    workspaceId,
    agentStatus,
    diffStat,
    prInfo,
  }: {
    worktree: WorktreeInfo & { label?: string };
    workspaceId: string;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    prInfo?: PrInfo;
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
      const newLabel =
        trimmed && trimmed !== worktree.branch && trimmed !== worktree.name ? trimmed : '';
      renameWorktree(workspaceId, worktree.name, newLabel);
      setEditing(false);
    }

    return (
      <div className="group/wt my-px mr-1.5 rounded-[5px] border-l-[3px] border-transparent py-0.75 pr-1.5 pl-3">
        <div className="flex items-center gap-1.5">
          <IconWithBadge agentStatus={agentStatus}>
            <FolderGit2 size={14} strokeWidth={1.5} stroke="var(--text-muted)" />
          </IconWithBadge>
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="m-0 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-lg text-[var(--text-secondary)] outline-none"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono text-lg text-text-secondary"
              onDoubleClick={startEditing}
            >
              {displayName}
            </span>
          )}
          {diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
        </div>
        <div className="mt-0.5 flex items-center pl-[20px]">
          <span className="truncate text-[11px] text-text-muted">
            {worktree.branch || worktree.name}
          </span>
          <span className="flex-1" />
          {prInfo && <PrBadge pr={prInfo} />}
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
    prev.diffStat?.deletions === next.diffStat?.deletions &&
    prev.prInfo?.number === next.prInfo?.number &&
    prev.prInfo?.state === next.prInfo?.state,
);

const repoHeader = tv({
  base: 'flex items-center gap-1.5 border-l-[3px] py-1.5 pr-1.5 pl-3 cursor-grab active:cursor-grabbing touch-none',
  variants: {
    selected: {
      true: 'border-accent bg-accent/[0.04]',
      false: 'border-transparent hover:bg-accent/[0.04]',
    },
  },
  defaultVariants: { selected: false },
});

const RepoHeader = memo(
  function RepoHeader({
    workspace,
    agentSummary,
    isSelected,
    onPlusClick,
    onRowClick,
    onContextMenu,
    dragListeners,
  }: {
    workspace: Workspace;
    agentSummary?: Array<'running' | 'waiting'>;
    isSelected: boolean;
    onPlusClick: () => void;
    onRowClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    dragListeners?: DraggableSyntheticListeners;
  }) {
    const childCount = workspace.branches.length + workspace.worktrees.length;

    return (
      <div
        className={repoHeader({ selected: isSelected })}
        onClick={onRowClick}
        onContextMenu={onContextMenu}
        {...dragListeners}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'}
          strokeWidth="1.5"
          className={`flex-shrink-0 ${isSelected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.4)]' : ''}`}
        >
          <path d="M3 6l5-4 5 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
        </svg>
        <span
          className={`flex-1 truncate text-lg font-medium ${isSelected ? 'text-text-primary' : 'text-text-muted'}`}
        >
          {workspace.name}
        </span>
        {!workspace.expanded && agentSummary && agentSummary.length > 0 && (
          <span className="ml-1 flex items-center gap-0.75">
            {agentSummary.slice(0, 3).map((status, i) => (
              <StatusDot key={i} status={status} size={5} />
            ))}
          </span>
        )}
        {childCount > 0 && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            <span className="rounded bg-bg-tertiary px-1.25 py-px font-mono text-xs text-text-muted tabular-nums">
              {childCount}
            </span>
          </span>
        )}
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onPress={onRowClick}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        >
          {workspace.expanded ? (
            <ChevronDown size={12} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={12} strokeWidth={1.5} />
          )}
        </Button>
        <Tooltip label="New branch / worktree" placement="right">
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            aria-label="New branch or worktree"
            onPress={onPlusClick}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          >
            <Plus size={12} strokeWidth={1.5} />
          </Button>
        </Tooltip>
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
    prev.onContextMenu === next.onContextMenu &&
    prev.agentSummary?.length === next.agentSummary?.length &&
    (prev.agentSummary ?? []).every((s, i) => s === next.agentSummary?.[i]) &&
    prev.dragListeners === next.dragListeners,
);

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
  const rawWorkspaces = useWorkspaces();
  const workspaces = useMemo(
    () => [...rawWorkspaces].sort((a, b) => a.position - b.position),
    [rawWorkspaces],
  );
  const { selectedItemId, activeContextId, sidebarVisible } = useUiState();
  const [closeTarget, setCloseTarget] = useState<Workspace | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{
    workspaceId: string;
    name: string;
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const agentMap = useWorkspaceAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useWorkspacePolling(workspaces, sidebarVisible && pageVisible);
  const settings = useSettings();
  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(workspaces, sidebarVisible && pageVisible, githubConnected);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useDragSensors();
  useDragStyle(activeId !== null);
  const { snapshot: flipSnapshot } = useFlipAnimation(listRef);

  // IDs that need a top separator — all except the first in the current visual order.
  // Recomputed on drag-over so separators update live as items shift.
  const separatorIds = useMemo(() => {
    const order =
      activeId && overId && activeId !== overId
        ? arrayMove(
            workspaces,
            workspaces.findIndex((w) => w.id === activeId),
            workspaces.findIndex((w) => w.id === overId),
          )
        : workspaces;
    return new Set(order.slice(1).map((w) => w.id));
  }, [workspaces, activeId, overId]);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      // Snapshot before any state update — DOM still has dnd-kit transforms here.
      flipSnapshot();
      setActiveId(null);
      setOverId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = workspaces.findIndex((w) => w.id === active.id);
      const newIndex = workspaces.findIndex((w) => w.id === over.id);
      const reordered = arrayMove(workspaces, oldIndex, newIndex);
      reorderWorkspaces(reordered.map((w) => w.id));
    },
    [workspaces, flipSnapshot],
  );

  const workspaceIds = useMemo(() => workspaces.map((w) => w.id), [workspaces]);

  const handleRequestOpenPalette = useCallback((ws: Workspace) => {
    openWorkspacePalette(makeWorkspacePaletteItem(ws));
  }, []);

  const handleSelectItem = useCallback(
    (itemId: string) => selectWorkspaceItem(itemId, navigate),
    [navigate],
  );

  return (
    <>
      <div className="px-3 pt-2 pb-1 font-mono text-xs font-semibold tracking-wider text-text-muted uppercase opacity-60">
        Projects
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragOver={({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
        }}
      >
        <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
          <div ref={listRef}>
            {workspaces.map((ws) => (
              <RepoTreeItem
                key={ws.id}
                ws={ws}
                agentMap={agentMap}
                diffStats={diffStatsMap[ws.id]}
                prStatuses={prMap[ws.id]}
                onRequestOpenPalette={handleRequestOpenPalette}
                onRequestClose={setCloseTarget}
                onRequestRemoveWt={(name) => setRemoveWtTarget({ workspaceId: ws.id, name })}
                selectedItemId={selectedItemId}
                activeContextId={activeContextId}
                hasSeparator={separatorIds.has(ws.id)}
                onSelectItem={handleSelectItem}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
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
            className={`w-full px-3 py-1.5 text-left text-base outline-none hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)] ${item.destructive ? 'text-destructive' : 'text-text-secondary'}`}
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
  prStatuses,
  onRequestOpenPalette,
  onRequestClose,
  onRequestRemoveWt,
  selectedItemId,
  activeContextId,
  hasSeparator,
  onSelectItem,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  prStatuses?: Record<string, PrInfo>;
  onRequestOpenPalette: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  onRequestRemoveWt: (name: string) => void;
  selectedItemId: string | null;
  activeContextId: string | null;
  hasSeparator: boolean;
  onSelectItem: (itemId: string) => void;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: ws.id,
    transition: sortableTransition,
  });
  const isDropping = useDropping(isDragging, 220);
  const agentSummary = useMemo(() => getRepoAgentSummary(ws, agentMap), [ws, agentMap]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });
  const [wtMenuTarget, setWtMenuTarget] = useState<string | null>(null);
  const wtMenuPos = useRef({ x: 0, y: 0 });

  const handlePlusClick = useCallback(() => {
    onRequestOpenPalette(ws);
  }, [ws, onRequestOpenPalette]);

  const handleRowClick = useCallback(() => {
    toggleExpanded(ws.id);
  }, [ws.id]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenuOpen(true);
  }

  const isRepoSelected =
    !!selectedItemId?.startsWith(ws.id) || !!activeContextId?.startsWith(ws.id);

  return (
    <>
      <div
        ref={setNodeRef}
        data-flip-id={ws.id}
        className={
          isDragging || isDropping ? 'pointer-events-none relative z-50 bg-bg-primary' : undefined
        }
        style={{
          transform: CSS.Transform.toString(
            transform ? { ...transform, scaleX: 1, scaleY: 1 } : null,
          ),
          transition,
        }}
      >
        {hasSeparator && <div className={`h-px bg-border${isDragging ? ' invisible' : ''}`} />}
        <RepoHeader
          workspace={ws}
          agentSummary={agentSummary}
          isSelected={isRepoSelected}
          onPlusClick={handlePlusClick}
          onRowClick={handleRowClick}
          onContextMenu={handleContextMenu}
          dragListeners={listeners}
        />
        {ws.expanded && (
          <>
            {ws.branches.map((b) => {
              const itemId = `${ws.id}-branch-${b.name}`;
              return (
                <div
                  key={itemId}
                  className={`outline-none hover:bg-bg-tertiary ${selectedItemId === itemId ? 'bg-[rgba(59,130,246,0.08)]' : ''}`}
                  onClick={() => onSelectItem(itemId)}
                >
                  <BranchRow
                    branch={b}
                    agentStatus={agentMap[itemId]}
                    diffStat={diffStats?.[b.name]}
                    prInfo={prStatuses?.[b.name]}
                  />
                </div>
              );
            })}
            {ws.worktrees.map((wt) => {
              const itemId = `${ws.id}-wt-${wt.name}`;
              return (
                <div
                  key={itemId}
                  className={`outline-none hover:bg-bg-tertiary ${selectedItemId === itemId ? 'bg-[rgba(59,130,246,0.08)]' : ''}`}
                  onClick={() => onSelectItem(itemId)}
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
                    agentStatus={agentMap[itemId]}
                    diffStat={diffStats?.[wt.branch]}
                    prInfo={prStatuses?.[wt.branch]}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
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
