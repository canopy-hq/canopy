import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';

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
  GitBranch,
  GitBranchMinus,
  GitPullRequest,
  Laptop,
  Pencil,
  Plus,
} from 'lucide-react';
import { tv } from 'tailwind-variants';

import { makeProjectPaletteItem } from '../commands/project-commands';
import { useProjects, useAgents, useTabs, useUiState, useSettings } from '../hooks/useCollections';
import { useDragStyle } from '../hooks/useDragStyle';
import { useDropping } from '../hooks/useDropping';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { usePageVisible } from '../hooks/usePageVisible';
import { useProjectPolling } from '../hooks/useProjectPolling';
import { usePrPolling } from '../hooks/usePrPolling';
import { restrictToVerticalAxis, sortableTransition, useDragSensors } from '../lib/dnd';
import { GITHUB_CONNECTION_KEY } from '../lib/github';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectProjectItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  renameWorktree,
  renameProject,
  reorderProjects,
  setProjectColor,
} from '../lib/project-actions';
import { openProjectPalette } from '../lib/project-palette-bridge';
import { closeAllTabs } from '../lib/tab-actions';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { StatusDot } from './StatusDot';
import { Badge, Button, DiffPill, IconWithBadge, Kbd, Spinner, Tooltip, ContextMenu } from './ui';

import type { BranchInfo, WorktreeInfo, DiffStat } from '../lib/git';
import type { PrInfo } from '../lib/github';
import type { DotStatus } from './StatusDot';
import type { ContextMenuItemDef } from './ui';
import type { Project } from '@superagent/db';

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
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1 py-px text-2xs font-normal whitespace-nowrap hover:brightness-125 ${PR_TEXT_COLOR[pr.state]} ${PR_BG_COLOR[pr.state]}`}
    >
      <GitPullRequest size={9} />#{pr.number}
    </button>
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
            className={`min-w-0 flex-1 truncate font-mono text-sm leading-none ${branch.is_head ? 'text-text-secondary' : 'text-text-muted'}`}
          >
            {branch.name}
          </span>
          {tabCount != null && tabCount > 0 && (
            <span className="shrink-0 rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs leading-none text-text-faint tabular-nums">
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
    projectId,
    agentStatus,
    diffStat,
    isDeleting,
    prInfo,
    isProjectActive,
    tabCount,
    isRenaming,
    onRenameEnd,
  }: {
    worktree: WorktreeInfo & { label?: string };
    projectId: string;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    isDeleting?: boolean;
    prInfo?: PrInfo;
    isProjectActive?: boolean;
    tabCount?: number;
    isRenaming?: boolean;
    onRenameEnd?: () => void;
  }) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const displayName = worktree.label || worktree.name;

    useEffect(() => {
      if (isRenaming && !editing) {
        setEditValue(displayName);
        setEditing(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    }, [isRenaming]); // eslint-disable-line react-hooks/exhaustive-deps

    function startEditing() {
      setEditValue(displayName);
      setEditing(true);
      requestAnimationFrame(() => inputRef.current?.select());
    }

    function commitEdit() {
      const trimmed = editValue.trim();
      const newLabel = trimmed && trimmed !== worktree.name ? trimmed : '';
      renameWorktree(projectId, worktree.name, newLabel);
      setEditing(false);
      onRenameEnd?.();
    }

    return (
      <div className={`group/wt py-1.5 pr-3 pl-3 ${isDeleting ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <div className="relative flex w-6 shrink-0 items-center justify-center">
              <Spinner size={14} className="text-destructive/60" />
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
                if (e.key === 'Escape') {
                  setEditing(false);
                  onRenameEnd?.();
                }
              }}
              className="m-0 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-sm leading-none text-[var(--text-secondary)] outline-none"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono text-sm leading-none text-text-muted"
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
              <span className="shrink-0 rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs leading-none text-text-faint tabular-nums">
                {tabCount}
              </span>
            )
          )}
        </div>
        {!isDeleting && (
          <div className="mt-1 flex min-w-0 items-center gap-2 pl-[32px]">
            <Badge size="xs" className="min-w-0 shrink gap-1 font-mono">
              <GitBranch size={9} className="shrink-0 opacity-60" />
              <span className="min-w-0 truncate">{worktree.branch || worktree.name}</span>
            </Badge>
          </div>
        )}
        {!isDeleting && !editing && (diffStat || prInfo) && (
          <div className="mt-1 flex items-center gap-1 pl-[32px]">
            {diffStat ? (
              diffStat.additions > 0 || diffStat.deletions > 0 ? (
                <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />
              ) : (
                <span className="font-mono text-xs text-text-faint">—</span>
              )
            ) : null}
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
    prev.projectId === next.projectId &&
    prev.agentStatus === next.agentStatus &&
    prev.isDeleting === next.isDeleting &&
    prev.isProjectActive === next.isProjectActive &&
    prev.tabCount === next.tabCount &&
    prev.isRenaming === next.isRenaming &&
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
    project,
    agentSummary,
    isSelected,
    isRenaming,
    onPlusClick,
    onRowClick,
    onContextMenu,
    onRenameCommit,
    onRenameCancel,
    dragListeners,
  }: {
    project: Project;
    agentSummary?: Array<'running' | 'waiting'>;
    isSelected: boolean;
    isRenaming: boolean;
    onPlusClick: () => void;
    onRowClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onRenameCommit: (name: string) => void;
    onRenameCancel: () => void;
    dragListeners?: DraggableSyntheticListeners;
  }) {
    const childCount = project.branches.length + project.worktrees.length;
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isRenaming) {
        setEditValue(project.name);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    }, [isRenaming, project.name]);

    const iconStyle = useMemo((): React.CSSProperties => {
      if (project.color) {
        return {
          '--c': project.color,
          color: isSelected
            ? 'color-mix(in srgb, var(--c) 100%, white)'
            : 'color-mix(in srgb, var(--c) 40%, var(--text-faint))',
          borderColor: isSelected ? 'color-mix(in srgb, var(--c) 80%, transparent)' : 'transparent',
          backgroundColor: isSelected
            ? 'color-mix(in srgb, var(--c) 35%, var(--bg-secondary))'
            : 'color-mix(in srgb, var(--c) 8%, var(--bg-secondary))',
        } as React.CSSProperties;
      }
      return isSelected
        ? {
            color: 'var(--text-primary)',
            borderColor: 'color-mix(in srgb, var(--text-muted) 40%, transparent)',
            backgroundColor: 'var(--bg-tertiary)',
          }
        : {
            color: 'var(--text-faint)',
            borderColor: 'transparent',
            backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 60%, var(--bg-secondary))',
          };
    }, [project.color, isSelected]);

    function commitRename() {
      onRenameCommit(editValue);
    }

    return (
      <div
        className={repoHeader({ selected: isSelected })}
        onClick={isRenaming ? undefined : onRowClick}
        onContextMenu={isRenaming ? undefined : onContextMenu}
        {...(isRenaming ? {} : dragListeners)}
      >
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-sm leading-none font-medium transition-colors duration-150"
          style={iconStyle}
        >
          {project.name.charAt(0).toUpperCase()}
        </div>
        {isRenaming ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 border-none bg-transparent font-mono text-lg font-medium text-text-primary outline-none"
          />
        ) : (
          <span className="flex-1 truncate font-mono text-lg font-medium text-text-primary">
            {project.name}
          </span>
        )}
        {!isRenaming && !project.expanded && agentSummary && agentSummary.length > 0 && (
          <span className="ml-1 flex items-center gap-0.75">
            {agentSummary.slice(0, 3).map((status, i) => (
              <StatusDot key={i} status={status} size={5} />
            ))}
          </span>
        )}
        {!isRenaming && !project.expanded && childCount > 0 && (
          <span className="rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs leading-none text-text-faint tabular-nums">
            {childCount}
          </span>
        )}
        {!isRenaming && (
          <>
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              onPress={onRowClick}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
            >
              {project.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </Button>
            <Tooltip label="New worktree" placement="right">
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
          </>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.project.id === next.project.id &&
    prev.project.name === next.project.name &&
    prev.project.color === next.project.color &&
    prev.project.expanded === next.project.expanded &&
    prev.project.branches.length === next.project.branches.length &&
    prev.project.worktrees.length === next.project.worktrees.length &&
    prev.isSelected === next.isSelected &&
    prev.isRenaming === next.isRenaming &&
    prev.onPlusClick === next.onPlusClick &&
    prev.onRowClick === next.onRowClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.agentSummary?.length === next.agentSummary?.length &&
    (prev.agentSummary ?? []).every((s, i) => s === next.agentSummary?.[i]) &&
    prev.dragListeners === next.dragListeners,
);

function useProjectAgentMap(): Record<string, DotStatus> {
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
      const existing = result[tab.projectItemId];
      if (best === 'waiting' || (best === 'running' && existing !== 'waiting')) {
        result[tab.projectItemId] = best;
      } else if (!existing) {
        result[tab.projectItemId] = best;
      }
    }
    return result;
  }, [agents, tabs]);
}

function getRepoAgentSummary(
  ws: Project,
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

export function ProjectTree({ onAddProject }: { onAddProject?: () => void }) {
  const rawProjects = useProjects();
  const projects = useMemo(
    () => [...rawProjects].sort((a, b) => a.position - b.position),
    [rawProjects],
  );
  const { selectedItemId, activeContextId, sidebarVisible, creatingWorktreeIds } = useUiState();
  const creatingWorktreeIdSet = useMemo(() => new Set(creatingWorktreeIds), [creatingWorktreeIds]);
  const tabs = useTabs();
  const tabCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tab of tabs) {
      map[tab.projectItemId] = (map[tab.projectItemId] ?? 0) + 1;
    }
    return map;
  }, [tabs]);
  const [closeTarget, setCloseTarget] = useState<Project | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{ projectId: string; name: string } | null>(
    null,
  );
  const [deletingWtIds, setDeletingWtIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const agentMap = useProjectAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useProjectPolling(
    projects,
    sidebarVisible && pageVisible,
    activeContextId ?? undefined,
  );
  const settings = useSettings();
  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(projects, sidebarVisible && pageVisible, githubConnected);
  const navigate = useNavigate();
  const sensors = useDragSensors();
  useDragStyle(activeId !== null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const { snapshot: flipSnapshot } = useFlipAnimation(projectListRef, 'vertical');

  // Stable separators — never update during drag to avoid layout shifts.
  const separatorIds = useMemo(() => new Set(projects.slice(1).map((w) => w.id)), [projects]);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      flipSnapshot();
      setActiveId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = projects.findIndex((w) => w.id === active.id);
      const newIndex = projects.findIndex((w) => w.id === over.id);
      const reordered = arrayMove(projects, oldIndex, newIndex);
      reorderProjects(reordered.map((w) => w.id));
    },
    [projects, flipSnapshot],
  );

  const projectIds = useMemo(() => projects.map((w) => w.id), [projects]);

  const handleRequestOpenPalette = useCallback((ws: Project) => {
    openProjectPalette(makeProjectPaletteItem(ws));
  }, []);

  const handleSelectItem = useCallback(
    (itemId: string) => selectProjectItem(itemId, navigate),
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
        <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
          <div ref={projectListRef}>
            {projects.map((ws) => (
              <RepoTreeItem
                key={ws.id}
                ws={ws}
                agentMap={agentMap}
                diffStats={diffStatsMap[ws.id]}
                prStatuses={prMap[ws.id]}
                tabCounts={tabCountMap}
                onRequestOpenPalette={handleRequestOpenPalette}
                onRequestClose={setCloseTarget}
                onRequestRemoveWt={(name) => setRemoveWtTarget({ projectId: ws.id, name })}
                selectedItemId={selectedItemId}
                activeContextId={activeContextId}
                hasSeparator={separatorIds.has(ws.id)}
                onSelectItem={handleSelectItem}
                deletingWtIds={deletingWtIds}
                creatingWorktreeIds={creatingWorktreeIdSet}
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
            const { projectId, name } = removeWtTarget;
            const itemId = `${projectId}-wt-${name}`;
            setRemoveWtTarget(null);
            closeAllTabs(itemId);

            // If the deleted wt is the active context, redirect to the first remaining item.
            if (activeContextId === itemId) {
              const ws = projects.find((w) => w.id === projectId);
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
              void removeWorktree(projectId, name)
                .then(() => {
                  hideWorktree(projectId, name);
                })
                .finally(() => {
                  setDeletingWtIds((prev) => {
                    const s = new Set(prev);
                    s.delete(itemId);
                    return s;
                  });
                });
            } else {
              hideWorktree(projectId, name);
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
  ws: Project;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  prStatuses?: Record<string, PrInfo>;
  tabCounts: Record<string, number>;
  onRequestOpenPalette: (ws: Project) => void;
  onRequestClose: (ws: Project) => void;
  onRequestRemoveWt: (name: string) => void;
  selectedItemId: string | null;
  activeContextId: string | null;
  hasSeparator: boolean;
  onSelectItem: (itemId: string) => void;
  deletingWtIds: Set<string>;
  creatingWorktreeIds: Set<string>;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: ws.id,
    transition: sortableTransition,
  });
  const isDropping = useDropping(isDragging, 220);
  const agentSummary = useMemo(() => getRepoAgentSummary(ws, agentMap), [ws, agentMap]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });
  const [renamingWs, setRenamingWs] = useState(false);
  const [wtMenuTarget, setWtMenuTarget] = useState<string | null>(null);
  const wtMenuPos = useRef({ x: 0, y: 0 });
  const [renamingWtName, setRenamingWtName] = useState<string | null>(null);
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
          project={ws}
          agentSummary={agentSummary}
          isSelected={isRepoSelected}
          isRenaming={renamingWs}
          onPlusClick={handlePlusClick}
          onRowClick={handleRowClick}
          onContextMenu={handleContextMenu}
          onRenameCommit={(name) => {
            renameProject(ws.id, name);
            setRenamingWs(false);
          }}
          onRenameCancel={() => setRenamingWs(false)}
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
              .filter((wt) => !creatingWorktreeIds.has(`${ws.id}-wt-${wt.name}`))
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
                      projectId={ws.id}
                      agentStatus={agentMap[itemId]}
                      diffStat={diffStats?.[wt.branch]}
                      isDeleting={isDeleting}
                      prInfo={prStatuses?.[wt.branch]}
                      isProjectActive={isRepoSelected}
                      tabCount={tabCounts[itemId]}
                      isRenaming={renamingWtName === wt.name}
                      onRenameEnd={() => setRenamingWtName(null)}
                    />
                  </div>
                );
              })}
            {[...creatingWorktreeIds]
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
                          <Spinner size={14} className="text-accent/60" />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-faint">
                          {name}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-accent/50">creating…</span>
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
                label: 'Rename',
                icon: <Pencil size={13} />,
                onSelect: () => {
                  setMenuOpen(false);
                  setRenamingWs(true);
                },
              },
              {
                type: 'submenu',
                label: 'Set color',
                icon: ws.color ? (
                  <div className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: ws.color }} />
                ) : (
                  <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/60 text-[9px] leading-none text-text-faint">
                    ✕
                  </div>
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
                    onSelect: () => setProjectColor(ws.id, null),
                  },
                  { type: 'separator' },
                  ...WORKSPACE_COLORS.map(({ value, label }) => ({
                    label,
                    icon: (
                      <div className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: value }} />
                    ),
                    checked: ws.color === value,
                    onSelect: () => setProjectColor(ws.id, value),
                  })),
                ] satisfies ContextMenuItemDef[],
              },
              {
                label: 'Close project',
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
              type: 'submenu',
              label: 'Copy',
              icon: <Copy size={13} />,
              items: [
                {
                  label: 'Path',
                  onSelect: () => {
                    setBranchMenuTarget(null);
                    void navigator.clipboard.writeText(ws.path);
                  },
                },
                {
                  label: 'Branch',
                  onSelect: () => {
                    const name = branchMenuTarget;
                    setBranchMenuTarget(null);
                    if (name) void navigator.clipboard.writeText(name);
                  },
                },
              ],
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
              label: 'Rename',
              icon: <Pencil size={13} />,
              onSelect: () => {
                const name = wtMenuTarget;
                setWtMenuTarget(null);
                setRenamingWtName(name);
              },
            },
            {
              type: 'submenu',
              label: 'Copy',
              icon: <Copy size={13} />,
              items: [
                {
                  label: 'Path',
                  onSelect: () => {
                    const wt = ws.worktrees.find((w) => w.name === wtMenuTarget);
                    setWtMenuTarget(null);
                    if (wt) void navigator.clipboard.writeText(wt.path);
                  },
                },
                {
                  label: 'Branch',
                  onSelect: () => {
                    const wt = ws.worktrees.find((w) => w.name === wtMenuTarget);
                    setWtMenuTarget(null);
                    if (wt) void navigator.clipboard.writeText(wt.branch);
                  },
                },
              ],
            },
            {
              label: 'Close worktree',
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
