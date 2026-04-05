import { useState, useRef, useCallback, useMemo, memo } from 'react';

import {
  DndContext,
  closestCenter,
  type DragEndEvent,
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
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderGit2,
  FolderPlus,
  FolderX,
  GitBranchMinus,
  GitPullRequest,
  Laptop,
  Loader2,
  Plus,
} from 'lucide-react';
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
import { closeAllTabs } from '../lib/tab-actions';
import {
  toggleExpanded,
  selectWorkspaceItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  renameWorktree,
  reorderWorkspaces,
  setWorkspaceColor,
} from '../lib/workspace-actions';
import { openWorkspacePalette } from '../lib/workspace-palette-bridge';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { StatusDot } from './StatusDot';
import { Button, Kbd, Tooltip, ContextMenu } from './ui';

import type { BranchInfo, WorktreeInfo, DiffStat } from '../lib/git';
import type { PrInfo } from '../lib/github';
import type { DotStatus } from './StatusDot';
import type { ContextMenuItemDef } from './ui';
import type { Workspace } from '@superagent/db';

const WORKSPACE_COLORS: Array<{ value: string; label: string }> = [
  { value: '#f59e0b', label: 'Amber' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#84cc16', label: 'Lime' },
  { value: '#f97316', label: 'Orange' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ef4444', label: 'Red' },
  { value: '#14b8a6', label: 'Teal' },
];

const DiffPill = memo(function DiffPill({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 gap-1 rounded-sm bg-white/[0.04] px-1.5 py-px text-sm font-normal whitespace-nowrap">
      {additions > 0 && <span className="text-(--git-ahead) tabular-nums">+{additions}</span>}
      {deletions > 0 && (
        <span className="text-(--git-behind) tabular-nums">&minus;{deletions}</span>
      )}
    </span>
  );
});

const PR_TEXT_COLOR: Record<PrInfo['state'], string> = {
  OPEN: 'text-emerald-500',
  DRAFT: 'text-text-muted',
  MERGED: 'text-purple-500',
  CLOSED: 'text-text-muted',
};
const PR_BG_COLOR: Record<PrInfo['state'], string> = {
  OPEN: 'bg-emerald-500/10',
  DRAFT: 'bg-white/[0.04]',
  MERGED: 'bg-purple-500/10',
  CLOSED: 'bg-white/[0.04]',
};

const PrBadge = memo(function PrBadge({ pr }: { pr: PrInfo }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void openUrl(pr.url);
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-sm font-normal whitespace-nowrap hover:brightness-125 ${PR_TEXT_COLOR[pr.state]} ${PR_BG_COLOR[pr.state]}`}
    >
      <GitPullRequest size={12} />#{pr.number}
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
    <div className="relative flex w-6 shrink-0 items-center justify-center">
      {children}
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
    isProjectActive,
    tabCount,
  }: {
    branch: BranchInfo;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    prInfo?: PrInfo;
    isProjectActive?: boolean;
    tabCount?: number;
  }) {
    return (
      <div className="py-1.5 pr-3 pl-3">
        <div className="flex items-center gap-2">
          <IconWithBadge agentStatus={agentStatus}>
            <Laptop size={14} stroke={isProjectActive ? 'var(--accent)' : 'var(--text-muted)'} />
          </IconWithBadge>
          <span
            className={`min-w-0 flex-1 truncate font-mono text-sm ${branch.is_head ? 'text-text-secondary' : 'text-text-muted'}`}
          >
            {branch.name}
          </span>
          {tabCount != null && tabCount > 0 && (
            <span className="shrink-0 rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs text-text-faint tabular-nums">
              {tabCount}
            </span>
          )}
        </div>
        {(diffStat || prInfo) && (
          <div className="mt-1 flex items-center gap-2 pl-[32px]">
            {diffStat &&
              (diffStat.additions > 0 || diffStat.deletions > 0 ? (
                <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />
              ) : (
                <span className="font-mono text-xs text-text-faint">—</span>
              ))}
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
    prev.isProjectActive === next.isProjectActive &&
    prev.tabCount === next.tabCount &&
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
    isDeleting,
    prInfo,
    isProjectActive,
    tabCount,
  }: {
    worktree: WorktreeInfo & { label?: string };
    workspaceId: string;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    isDeleting?: boolean;
    prInfo?: PrInfo;
    isProjectActive?: boolean;
    tabCount?: number;
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
      <div className={`group/wt py-1.5 pr-3 pl-3 ${isDeleting ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <div className="relative flex w-6 shrink-0 items-center justify-center">
              <Loader2 size={14} className="animate-spin text-destructive/60" />
            </div>
          ) : (
            <IconWithBadge agentStatus={agentStatus}>
              <FolderGit2
                size={14}
                stroke={isProjectActive ? 'var(--worktree-icon)' : 'var(--text-muted)'}
              />
            </IconWithBadge>
          )}
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
              className="m-0 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-sm text-[var(--text-secondary)] outline-none"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono text-sm text-text-muted"
              onDoubleClick={startEditing}
            >
              {displayName}
            </span>
          )}
          {isDeleting ? (
            <span className="shrink-0 font-mono text-xs text-destructive/50">removing…</span>
          ) : (
            !editing &&
            tabCount != null &&
            tabCount > 0 && (
              <span className="shrink-0 rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs text-text-faint tabular-nums">
                {tabCount}
              </span>
            )
          )}
        </div>
        {!isDeleting &&
          (diffStat ||
            prInfo ||
            (!editing && displayName !== (worktree.branch || worktree.name))) && (
            <div className="mt-1 flex items-center gap-2 pl-[32px]">
              {diffStat ? (
                diffStat.additions > 0 || diffStat.deletions > 0 ? (
                  <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />
                ) : (
                  <span className="font-mono text-xs text-text-faint">—</span>
                )
              ) : null}
              {!editing && displayName !== (worktree.branch || worktree.name) && (
                <span className="min-w-0 truncate font-mono text-xs text-text-faint">
                  {worktree.branch || worktree.name}
                </span>
              )}
              {prInfo && <PrBadge pr={prInfo} />}
            </div>
          )}
      </div>
    );
  },
  (prev, next) =>
    prev.worktree.name === next.worktree.name &&
    prev.worktree.branch === next.worktree.branch &&
    prev.worktree.label === next.worktree.label &&
    prev.workspaceId === next.workspaceId &&
    prev.agentStatus === next.agentStatus &&
    prev.isDeleting === next.isDeleting &&
    prev.isProjectActive === next.isProjectActive &&
    prev.tabCount === next.tabCount &&
    prev.diffStat?.additions === next.diffStat?.additions &&
    prev.diffStat?.deletions === next.diffStat?.deletions &&
    prev.prInfo?.number === next.prInfo?.number &&
    prev.prInfo?.state === next.prInfo?.state,
);

const repoHeader = tv({
  base: 'flex items-center gap-2 py-1.5 pr-2 pl-3 cursor-grab active:cursor-grabbing touch-none bg-bg-primary brightness-[1.6] transition-[filter]',
  variants: { selected: { true: 'brightness-[1.0]', false: 'hover:brightness-[1.3]' } },
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
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-sm leading-none font-medium transition-colors duration-150"
          style={
            workspace.color
              ? ({
                  '--c': workspace.color,
                  color: isSelected
                    ? 'color-mix(in srgb, var(--c) 100%, white)'
                    : 'color-mix(in srgb, var(--c) 40%, var(--text-faint))',
                  borderColor: isSelected
                    ? 'color-mix(in srgb, var(--c) 80%, transparent)'
                    : 'transparent',
                  backgroundColor: isSelected
                    ? 'color-mix(in srgb, var(--c) 35%, var(--bg-secondary))'
                    : 'color-mix(in srgb, var(--c) 8%, var(--bg-secondary))',
                } as React.CSSProperties)
              : isSelected
                ? {
                    color: 'var(--text-primary)',
                    borderColor: 'color-mix(in srgb, var(--text-muted) 40%, transparent)',
                    backgroundColor: 'var(--bg-tertiary)',
                  }
                : {
                    color: 'var(--text-faint)',
                    borderColor: 'transparent',
                    backgroundColor:
                      'color-mix(in srgb, var(--bg-tertiary) 60%, var(--bg-secondary))',
                  }
          }
        >
          {workspace.name.charAt(0).toUpperCase()}
        </div>
        <span className="flex-1 truncate font-mono text-lg font-medium text-text-primary">
          {workspace.name}
        </span>
        {!workspace.expanded && agentSummary && agentSummary.length > 0 && (
          <span className="ml-1 flex items-center gap-0.75">
            {agentSummary.slice(0, 3).map((status, i) => (
              <StatusDot key={i} status={status} size={5} />
            ))}
          </span>
        )}
        {!workspace.expanded && childCount > 0 && (
          <span className="rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs text-text-faint tabular-nums">
            {childCount}
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
          {workspace.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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
            <Plus size={12} />
          </Button>
        </Tooltip>
      </div>
    );
  },
  (prev, next) =>
    prev.workspace.id === next.workspace.id &&
    prev.workspace.name === next.workspace.name &&
    prev.workspace.color === next.workspace.color &&
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

export function WorkspaceTree({ onAddProject }: { onAddProject?: () => void }) {
  const rawWorkspaces = useWorkspaces();
  const workspaces = useMemo(
    () => [...rawWorkspaces].sort((a, b) => a.position - b.position),
    [rawWorkspaces],
  );
  const { selectedItemId, activeContextId, sidebarVisible, creatingWorktreeIds } = useUiState();
  const tabs = useTabs();
  const tabCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tab of tabs) {
      map[tab.workspaceItemId] = (map[tab.workspaceItemId] ?? 0) + 1;
    }
    return map;
  }, [tabs]);
  const [closeTarget, setCloseTarget] = useState<Workspace | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{
    workspaceId: string;
    name: string;
  } | null>(null);
  const [deletingWtIds, setDeletingWtIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const agentMap = useWorkspaceAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useWorkspacePolling(workspaces, sidebarVisible && pageVisible);
  const settings = useSettings();
  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(workspaces, sidebarVisible && pageVisible, githubConnected);
  const navigate = useNavigate();
  const sensors = useDragSensors();
  useDragStyle(activeId !== null);
  const workspaceListRef = useRef<HTMLDivElement>(null);
  const { snapshot: flipSnapshot } = useFlipAnimation(workspaceListRef, 'vertical');

  // Stable separators — never update during drag to avoid layout shifts.
  const separatorIds = useMemo(() => new Set(workspaces.slice(1).map((w) => w.id)), [workspaces]);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      flipSnapshot();
      setActiveId(null);
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
      <div className="flex h-10 items-center pr-2 pl-3">
        <span className="flex-1 font-mono text-2xs font-medium tracking-widest text-text-faint uppercase">
          Projects
        </span>
        {onAddProject && (
          <Tooltip
            label={
              <>
                Add project <Kbd>⌘N</Kbd>
              </>
            }
            placement="right"
          >
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              onPress={onAddProject}
              aria-label="Add project"
            >
              <FolderPlus size={12} />
            </Button>
          </Tooltip>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
          <div ref={workspaceListRef}>
            {workspaces.map((ws) => (
              <RepoTreeItem
                key={ws.id}
                ws={ws}
                agentMap={agentMap}
                diffStats={diffStatsMap[ws.id]}
                prStatuses={prMap[ws.id]}
                tabCounts={tabCountMap}
                onRequestOpenPalette={handleRequestOpenPalette}
                onRequestClose={setCloseTarget}
                onRequestRemoveWt={(name) => setRemoveWtTarget({ workspaceId: ws.id, name })}
                selectedItemId={selectedItemId}
                activeContextId={activeContextId}
                hasSeparator={separatorIds.has(ws.id)}
                onSelectItem={handleSelectItem}
                deletingWtIds={deletingWtIds}
                creatingWorktreeIds={creatingWorktreeIds}
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
          onConfirm={(alsoDeleteGit) => {
            const { workspaceId, name } = removeWtTarget;
            const itemId = `${workspaceId}-wt-${name}`;
            setRemoveWtTarget(null);
            closeAllTabs(itemId);

            // If the deleted wt is the active context, redirect to the first remaining item.
            if (activeContextId === itemId) {
              const ws = workspaces.find((w) => w.id === workspaceId);
              const fallback = ws
                ? [
                    ...ws.branches.map((b) => `${ws.id}-branch-${b.name}`),
                    ...ws.worktrees
                      .filter((wt) => wt.name !== name)
                      .map((wt) => `${ws.id}-wt-${wt.name}`),
                  ][0]
                : null;
              if (fallback) handleSelectItem(fallback);
            }

            if (alsoDeleteGit) {
              setDeletingWtIds((prev) => new Set([...prev, itemId]));
              void removeWorktree(workspaceId, name)
                .then(() => {
                  hideWorktree(workspaceId, name);
                })
                .finally(() => {
                  setDeletingWtIds((prev) => {
                    const s = new Set(prev);
                    s.delete(itemId);
                    return s;
                  });
                });
            } else {
              hideWorktree(workspaceId, name);
            }
          }}
        />
      )}
    </>
  );
}

function RepoTreeItem({
  ws,
  agentMap,
  diffStats,
  prStatuses,
  tabCounts,
  onRequestOpenPalette,
  onRequestClose,
  onRequestRemoveWt,
  selectedItemId,
  activeContextId,
  hasSeparator,
  onSelectItem,
  deletingWtIds,
  creatingWorktreeIds,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  prStatuses?: Record<string, PrInfo>;
  tabCounts: Record<string, number>;
  onRequestOpenPalette: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  onRequestRemoveWt: (name: string) => void;
  selectedItemId: string | null;
  activeContextId: string | null;
  hasSeparator: boolean;
  onSelectItem: (itemId: string) => void;
  deletingWtIds: Set<string>;
  creatingWorktreeIds: string[];
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
  const [branchMenuTarget, setBranchMenuTarget] = useState<string | null>(null);
  const branchMenuPos = useRef({ x: 0, y: 0 });

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

  const isActive = !!activeContextId?.startsWith(ws.id);
  const isRepoSelected = !!selectedItemId?.startsWith(ws.id) || isActive;

  const draggingCls = isDragging || isDropping ? 'pointer-events-none relative z-50' : '';
  const blockCls =
    isDragging || isDropping
      ? 'bg-bg-tertiary'
      : isActive
        ? 'bg-bg-tertiary/70'
        : 'bg-bg-tertiary/40';

  return (
    <>
      <div
        ref={setNodeRef}
        data-flip-id={ws.id}
        className={`${hasSeparator ? 'mt-3' : ''} ${draggingCls} ${blockCls}`.trim() || undefined}
        style={{
          transform: CSS.Transform.toString(
            transform ? { ...transform, scaleX: 1, scaleY: 1 } : null,
          ),
          transition,
          opacity: 1,
        }}
      >
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
                  className={`transition-colors outline-none hover:bg-white/[0.06] ${selectedItemId === itemId ? 'bg-accent/[0.08]' : ''}`}
                  onClick={() => onSelectItem(itemId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    branchMenuPos.current = { x: e.clientX, y: e.clientY };
                    setBranchMenuTarget(b.name);
                  }}
                >
                  <BranchRow
                    branch={b}
                    agentStatus={agentMap[itemId]}
                    diffStat={diffStats?.[b.name]}
                    prInfo={prStatuses?.[b.name]}
                    isProjectActive={isRepoSelected}
                    tabCount={tabCounts[itemId]}
                  />
                </div>
              );
            })}
            {ws.worktrees
              .filter((wt) => !creatingWorktreeIds.includes(`${ws.id}-wt-${wt.name}`))
              .map((wt) => {
                const itemId = `${ws.id}-wt-${wt.name}`;
                const isDeleting = deletingWtIds.has(itemId);
                return (
                  <div
                    key={itemId}
                    className={`transition-colors outline-none ${isDeleting ? 'pointer-events-none' : 'hover:bg-white/[0.06]'} ${selectedItemId === itemId ? 'bg-accent/[0.08]' : ''}`}
                    onClick={() => !isDeleting && onSelectItem(itemId)}
                    onContextMenu={(e) => {
                      if (isDeleting) return;
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
                      isDeleting={isDeleting}
                      prInfo={prStatuses?.[wt.branch]}
                      isProjectActive={isRepoSelected}
                      tabCount={tabCounts[itemId]}
                    />
                  </div>
                );
              })}
            {creatingWorktreeIds
              .filter((id) => id.startsWith(`${ws.id}-wt-`))
              .map((id) => {
                const name = id.slice(`${ws.id}-wt-`.length);
                const isSelected = selectedItemId === id;
                return (
                  <div
                    key={id}
                    className={`transition-colors outline-none hover:bg-white/[0.06] ${isSelected ? 'bg-accent/[0.08]' : ''}`}
                    onClick={() => onSelectItem(id)}
                  >
                    <div className="py-1.5 pr-3 pl-3">
                      <div className="flex items-center gap-2">
                        <div className="relative flex w-6 shrink-0 items-center justify-center">
                          <Loader2 size={14} className="animate-spin text-accent/60" />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-faint">
                          {name}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-accent/50">adding…</span>
                      </div>
                    </div>
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
          items={
            [
              {
                type: 'submenu',
                label: 'Set color',
                icon: (
                  <div
                    className="h-3.5 w-3.5 rounded-sm border border-border/60"
                    style={
                      ws.color ? { backgroundColor: ws.color, borderColor: 'transparent' } : {}
                    }
                  />
                ),
                items: [
                  {
                    label: 'No color',
                    icon: (
                      <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/60 text-[9px] leading-none text-text-faint">
                        ✕
                      </div>
                    ),
                    checked: !ws.color,
                    onSelect: () => setWorkspaceColor(ws.id, null),
                  },
                  ...WORKSPACE_COLORS.map(({ value, label }) => ({
                    label,
                    icon: (
                      <div className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: value }} />
                    ),
                    checked: ws.color === value,
                    onSelect: () => setWorkspaceColor(ws.id, value),
                  })),
                ] satisfies ContextMenuItemDef[],
              },
              {
                label: 'Close Project',
                icon: <FolderX size={13} />,
                destructive: true,
                onSelect: () => {
                  setMenuOpen(false);
                  onRequestClose(ws);
                },
              },
            ] satisfies ContextMenuItemDef[]
          }
        />
      )}
      {branchMenuTarget && (
        <ContextMenu
          x={branchMenuPos.current.x}
          y={branchMenuPos.current.y}
          onClose={() => setBranchMenuTarget(null)}
          items={[
            {
              label: 'Copy Path',
              icon: <Copy size={13} />,
              onSelect: () => {
                setBranchMenuTarget(null);
                void navigator.clipboard.writeText(ws.path);
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
              label: 'Copy Path',
              icon: <Copy size={13} />,
              onSelect: () => {
                const wt = ws.worktrees.find((w) => w.name === wtMenuTarget);
                setWtMenuTarget(null);
                if (wt) void navigator.clipboard.writeText(wt.path);
              },
            },
            {
              label: 'Close Worktree',
              icon: <GitBranchMinus size={13} />,
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
