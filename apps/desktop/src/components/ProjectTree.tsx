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
import {
  Badge,
  badge,
  Button,
  DiffPill,
  IconWithBadge,
  Kbd,
  Spinner,
  StatusDot,
  Tooltip,
  ContextMenu,
} from '@superagent/ui';
import { useNavigate } from '@tanstack/react-router';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  FolderX,
  GitBranch,
  GitBranchMinus,
  GitPullRequest,
  GripVertical,
  Laptop,
  Layers,
  Pencil,
  Plus,
} from 'lucide-react';
import { tv } from 'tailwind-variants';

import { makeProjectPaletteItem } from '../commands/project-commands';
import {
  useGroups,
  useProjects,
  useAgents,
  useTabs,
  useUiState,
  useSettings,
} from '../hooks/useCollections';
import { useDragStyle } from '../hooks/useDragStyle';
import { useDropping } from '../hooks/useDropping';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { usePageVisible } from '../hooks/usePageVisible';
import { useProjectPolling } from '../hooks/useProjectPolling';
import { usePrPolling } from '../hooks/usePrPolling';
import { restrictToVerticalAxis, sortableTransition, useDragSensors } from '../lib/dnd';
import { GITHUB_CONNECTION_KEY } from '../lib/github';
import {
  createGroup,
  deleteGroup,
  renameGroup,
  toggleGroupCollapsed,
  reorderGroups,
  assignProjectToGroup,
} from '../lib/group-actions';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  toggleExpanded,
  selectProjectItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  deleteBranch,
  renameWorktree,
  renameProject,
  reorderProjects,
  setProjectColor,
} from '../lib/project-actions';
import { openProjectPalette } from '../lib/project-palette-bridge';
import { closeAllTabs } from '../lib/tab-actions';
import { ClaudeCodeIcon } from './ClaudeCodeIcon';
import { CloseProjectModal } from './CloseProjectModal';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';

import type { BranchInfo, WorktreeInfo, DiffStat } from '../lib/git';
import type { PrInfo } from '../lib/github';
import type { Group, Project, CloneProgress } from '@superagent/db';
import type { ContextMenuItemDef, DotStatus } from '@superagent/ui';

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

const PR_COLOR: Record<PrInfo['state'], 'success' | 'neutral' | 'merged' | 'error'> = {
  OPEN: 'success',
  DRAFT: 'neutral',
  MERGED: 'merged',
  CLOSED: 'error',
};

const branchName = tv({
  base: 'min-w-0 flex-1 truncate font-mono text-sm leading-none',
  variants: { head: { true: 'text-text-secondary', false: 'text-text-muted' } },
});

const worktreeRow = tv({
  base: 'group/wt py-1.5 pr-3 pl-3',
  variants: { deleting: { true: 'opacity-50' } },
});

const PrBadge = memo(function PrBadge({ pr }: { pr: PrInfo }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void openUrl(pr.url);
      }}
      className={badge({
        color: PR_COLOR[pr.state],
        size: 'sm',
        class: 'gap-1 font-mono text-[11px] font-normal hover:brightness-125',
      })}
    >
      <GitPullRequest size={10} className="shrink-0" />#{pr.number}
    </button>
  );
});

const BranchRow = memo(
  function BranchRow({
    branch,
    agentStatus,
    diffStat,
    prInfo,
    isSelected,
    tabCount,
  }: {
    branch: BranchInfo;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    prInfo?: PrInfo;
    isSelected?: boolean;
    tabCount?: number;
  }) {
    return (
      <div className="py-1.5 pr-3 pl-3">
        <div className="flex items-center gap-2">
          <IconWithBadge agentStatus={agentStatus}>
            <Laptop size={14} stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'} />
          </IconWithBadge>
          <span className={branchName({ head: branch.is_head })}>{branch.name}</span>
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
    prev.isSelected === next.isSelected &&
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
    tabCount,
    isRenaming,
    isSelected,
    onRenameEnd,
  }: {
    worktree: WorktreeInfo & { label?: string };
    projectId: string;
    agentStatus?: DotStatus;
    diffStat?: DiffStat;
    isDeleting?: boolean;
    prInfo?: PrInfo;
    isSelected?: boolean;
    tabCount?: number;
    isRenaming?: boolean;
    onRenameEnd?: () => void;
  }) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const displayName = worktree.label || worktree.name;

    function startEditing() {
      setEditValue(displayName);
      setEditing(true);
      requestAnimationFrame(() => inputRef.current?.select());
    }

    useEffect(() => {
      if (isRenaming && !editing) startEditing();
    }, [isRenaming]); // eslint-disable-line react-hooks/exhaustive-deps

    function commitEdit() {
      const trimmed = editValue.trim();
      const newLabel = trimmed && trimmed !== worktree.name ? trimmed : '';
      renameWorktree(projectId, worktree.name, newLabel);
      setEditing(false);
      onRenameEnd?.();
    }

    return (
      <div className={worktreeRow({ deleting: isDeleting })}>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <div className="relative flex w-6 shrink-0 items-center justify-center">
              <Spinner size={14} className="text-destructive/60" />
            </div>
          ) : (
            <IconWithBadge agentStatus={agentStatus}>
              <FolderGit2 size={14} stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'} />
            </IconWithBadge>
          )}
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
              className="min-w-0 flex-1 truncate font-mono text-sm leading-none text-text-secondary"
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
            <Badge size="sm" className="min-w-0 shrink gap-1 font-mono text-[11px]">
              <GitBranch size={10} className="shrink-0 opacity-60" />
              <span className="min-w-0 truncate">{worktree.branch || worktree.name}</span>
            </Badge>
          </div>
        )}
        {!isDeleting && (diffStat || prInfo) && (
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
    prev.tabCount === next.tabCount &&
    prev.isSelected === next.isSelected &&
    prev.isRenaming === next.isRenaming &&
    prev.diffStat?.additions === next.diffStat?.additions &&
    prev.diffStat?.deletions === next.diffStat?.deletions &&
    prev.prInfo?.number === next.prInfo?.number &&
    prev.prInfo?.state === next.prInfo?.state,
);

const sidebarItem = tv({
  base: 'transition-colors outline-none hover:bg-white/[0.06]',
  variants: {
    selected: {
      true: 'sticky top-9 z-[5] [background:color-mix(in_srgb,var(--accent)_8%,var(--bg-primary))] hover:[background:color-mix(in_srgb,var(--accent)_12%,var(--bg-primary))]',
    },
    deleting: { true: 'pointer-events-none' },
  },
});

const repoHeader = tv({
  base: 'sticky top-0 z-10 flex items-center gap-2 py-1.5 pr-2 pl-3 touch-none bg-bg-primary brightness-[1.6] transition-[filter]',
  variants: {
    selected: { true: 'brightness-[1.0]', false: 'hover:brightness-[1.3]' },
    cloning: { true: 'cursor-default', false: 'cursor-grab active:cursor-grabbing' },
  },
  defaultVariants: { selected: false, cloning: false },
});

const RepoHeader = memo(
  function RepoHeader({
    project,
    agentSummary,
    isSelected,
    isRenaming,
    isCloning,
    cloneProgress,
    isInvalid,
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
    isCloning: boolean;
    cloneProgress?: CloneProgress;
    isInvalid: boolean;
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
        className={repoHeader({ selected: isSelected, cloning: isCloning })}
        onClick={isRenaming || isCloning ? undefined : onRowClick}
        onContextMenu={isRenaming ? undefined : onContextMenu}
        {...(isRenaming || isCloning ? {} : dragListeners)}
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
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
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
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-lg font-medium text-text-primary">
              {project.name}
            </span>
            {isInvalid && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-destructive/70">
                <AlertTriangle size={11} />
                not found
              </span>
            )}
            {isCloning && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-text-faint">
                {cloneProgress && cloneProgress.total > 0
                  ? `${cloneProgress.phase === 'resolving' ? 'resolving' : cloneProgress.phase === 'checkout' ? 'checking out' : 'receiving'} ${Math.round((cloneProgress.step / cloneProgress.total) * 100)}%`
                  : 'cloning…'}
                <Spinner size={11} className="text-accent/60" />
              </span>
            )}
          </>
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
            {!isCloning && (
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
            )}
            {!isCloning && (
              <Tooltip label="New worktree" placement="right">
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="New branch or worktree"
                  isDisabled={isInvalid}
                  onPress={onPlusClick}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
                >
                  <Plus size={12} />
                </Button>
              </Tooltip>
            )}
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
    prev.isCloning === next.isCloning &&
    prev.cloneProgress?.step === next.cloneProgress?.step &&
    prev.cloneProgress?.phase === next.cloneProgress?.phase &&
    prev.isInvalid === next.isInvalid &&
    prev.onPlusClick === next.onPlusClick &&
    prev.onRowClick === next.onRowClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.agentSummary?.length === next.agentSummary?.length &&
    (prev.agentSummary ?? []).every((s, i) => s === next.agentSummary?.[i]) &&
    prev.dragListeners === next.dragListeners,
);

const groupHeaderRow = tv({ base: 'flex items-center gap-1 px-3 py-1 select-none' });

const GroupHeader = memo(
  function GroupHeader({
    group,
    isRenaming,
    projectCount,
    onStartRename,
    onToggleCollapse,
    onContextMenu,
    onRenameCommit,
    onRenameCancel,
    dragListeners,
  }: {
    group: Group;
    isRenaming: boolean;
    projectCount: number;
    onStartRename: () => void;
    onToggleCollapse: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onRenameCommit: (name: string) => void;
    onRenameCancel: () => void;
    dragListeners?: DraggableSyntheticListeners;
  }) {
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isRenaming) {
        setEditValue(group.name);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    }, [isRenaming, group.name]);

    function commitRename() {
      onRenameCommit(editValue);
    }

    return (
      <div
        className={groupHeaderRow()}
        onContextMenu={isRenaming ? undefined : onContextMenu}
        {...(isRenaming ? {} : dragListeners)}
      >
        <GripVertical
          size={11}
          className="shrink-0 cursor-grab touch-none text-text-faint/30 active:cursor-grabbing"
        />
        {isRenaming ? (
          <input
            ref={inputRef}
            value={editValue}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onClick={(e) => e.stopPropagation()}
            className="m-0 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-xs font-semibold tracking-widest text-text-faint uppercase outline-none"
          />
        ) : (
          <span
            className="flex-1 truncate font-mono text-xs font-semibold tracking-widest text-text-faint uppercase"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
          >
            {group.name}
          </span>
        )}
        {group.collapsed && projectCount > 0 && (
          <span className="shrink-0 rounded-sm bg-bg-tertiary/60 px-1.25 py-px font-mono text-xs leading-none text-text-faint tabular-nums">
            {projectCount}
          </span>
        )}
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          className={projectCount === 0 ? 'invisible' : undefined}
          onPress={onToggleCollapse}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        >
          {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </Button>
      </div>
    );
  },
  (prev, next) =>
    prev.group.id === next.group.id &&
    prev.group.name === next.group.name &&
    prev.group.collapsed === next.group.collapsed &&
    prev.isRenaming === next.isRenaming &&
    prev.projectCount === next.projectCount &&
    prev.onStartRename === next.onStartRename &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.dragListeners === next.dragListeners,
);

function GroupTreeItem({
  group,
  groupProjects,
  isRenaming: isExternalRenaming,
  onRenameEnd,
  agentMap,
  diffStatsMap,
  prMap,
  tabCounts,
  onRequestOpenPalette,
  onRequestClose,
  onRequestRemoveWt,
  selectedItemId,
  activeContextId,
  onSelectItem,
  deletingWtIds,
  creatingWorktreeIds,
  cloningProjectIdSet,
  cloneProgressMap,
  pendingClaudeWorktreeId,
  groups,
}: {
  group: Group;
  groupProjects: Project[];
  isRenaming?: boolean;
  onRenameEnd?: () => void;
  agentMap: Record<string, DotStatus>;
  diffStatsMap: Record<string, Record<string, DiffStat>>;
  prMap: Record<string, Record<string, PrInfo>>;
  tabCounts: Record<string, number>;
  onRequestOpenPalette: (ws: Project) => void;
  onRequestClose: (ws: Project) => void;
  onRequestRemoveWt: (projectId: string, name: string, branch: string) => void;
  selectedItemId: string | null;
  activeContextId: string | null;
  onSelectItem: (itemId: string) => void;
  deletingWtIds: Set<string>;
  creatingWorktreeIds: Set<string>;
  cloningProjectIdSet: Set<string>;
  cloneProgressMap: Record<string, CloneProgress>;
  pendingClaudeWorktreeId: string | null;
  groups: Group[];
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: group.id,
    transition: sortableTransition,
  });
  const isDropping = useDropping(isDragging, 220);

  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (isExternalRenaming && !renaming) setRenaming(true);
  }, [isExternalRenaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });

  const projectSensors = useDragSensors();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  useDragStyle(activeProjectId !== null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const { snapshot: projectFlipSnapshot } = useFlipAnimation(projectListRef, 'vertical');

  const sortedProjects = useMemo(
    () => [...groupProjects].sort((a, b) => a.position - b.position),
    [groupProjects],
  );
  const projectIds = useMemo(() => sortedProjects.map((p) => p.id), [sortedProjects]);
  const separatorIds = useMemo(
    () => new Set(sortedProjects.slice(1).map((p) => p.id)),
    [sortedProjects],
  );

  const handleProjectDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      projectFlipSnapshot();
      setActiveProjectId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = sortedProjects.findIndex((p) => p.id === active.id);
      const newIndex = sortedProjects.findIndex((p) => p.id === over.id);
      const reordered = arrayMove(sortedProjects, oldIndex, newIndex);
      reorderProjects(reordered.map((p) => p.id));
    },
    [sortedProjects, projectFlipSnapshot],
  );

  const draggingCls = isDragging || isDropping ? 'pointer-events-none relative z-50' : '';
  const blockCls = isDragging || isDropping ? 'bg-bg-secondary' : '';

  return (
    <>
      <div
        ref={setNodeRef}
        data-flip-id={group.id}
        className={`${draggingCls} ${blockCls}`.trim() || undefined}
        style={{
          transform: CSS.Transform.toString(
            transform ? { ...transform, scaleX: 1, scaleY: 1 } : null,
          ),
          transition,
        }}
      >
        <GroupHeader
          group={group}
          isRenaming={renaming}
          projectCount={sortedProjects.length}
          onStartRename={() => setRenaming(true)}
          onToggleCollapse={() => toggleGroupCollapsed(group.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            menuPos.current = { x: e.clientX, y: e.clientY };
            setMenuOpen(true);
          }}
          onRenameCommit={(name) => {
            if (name.trim()) renameGroup(group.id, name);
            setRenaming(false);
            onRenameEnd?.();
          }}
          onRenameCancel={() => {
            setRenaming(false);
            onRenameEnd?.();
          }}
          dragListeners={listeners}
        />
        {!group.collapsed && (
          <DndContext
            sensors={projectSensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={({ active }) => setActiveProjectId(String(active.id))}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={() => setActiveProjectId(null)}
          >
            <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
              <div ref={projectListRef}>
                {sortedProjects.map((ws) => (
                  <RepoTreeItem
                    key={ws.id}
                    ws={ws}
                    agentMap={agentMap}
                    diffStats={diffStatsMap[ws.id]}
                    prStatuses={prMap[ws.id]}
                    tabCounts={tabCounts}
                    onRequestOpenPalette={onRequestOpenPalette}
                    onRequestClose={onRequestClose}
                    onRequestRemoveWt={(name, branch) => onRequestRemoveWt(ws.id, name, branch)}
                    selectedItemId={selectedItemId}
                    activeContextId={activeContextId}
                    hasSeparator={separatorIds.has(ws.id)}
                    onSelectItem={onSelectItem}
                    deletingWtIds={deletingWtIds}
                    creatingWorktreeIds={creatingWorktreeIds}
                    isCloning={cloningProjectIdSet.has(ws.id)}
                    cloneProgress={cloneProgressMap[ws.id]}
                    isInvalid={ws.invalid}
                    pendingClaudeWorktreeId={pendingClaudeWorktreeId}
                    groups={groups}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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
                  setRenaming(true);
                },
              },
              {
                label: 'Delete group',
                icon: <FolderX size={13} />,
                destructive: true,
                onSelect: () => {
                  setMenuOpen(false);
                  deleteGroup(group.id);
                },
              },
            ] satisfies ContextMenuItemDef[]
          }
        />
      )}
    </>
  );
}

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
  const rawGroups = useGroups();

  const groups = useMemo(() => [...rawGroups].sort((a, b) => a.position - b.position), [rawGroups]);
  const hasGroups = groups.length > 0;

  // Bucket projects into groups (keyed by groupId) and ungrouped (null).
  const projectsByGroup = useMemo(() => {
    const map = new Map<string | null, Project[]>();
    map.set(null, []);
    for (const g of groups) map.set(g.id, []);
    for (const p of rawProjects) {
      const key = p.groupId && map.has(p.groupId) ? p.groupId : null;
      map.get(key)!.push(p);
    }
    return map;
  }, [rawProjects, groups]);

  const ungroupedProjects = useMemo(
    () => [...(projectsByGroup.get(null) ?? [])].sort((a, b) => a.position - b.position),
    [projectsByGroup],
  );

  // All projects flat — needed for polling.
  const allProjects = useMemo(() => rawProjects, [rawProjects]);

  const {
    selectedItemId,
    activeContextId,
    sidebarVisible,
    creatingWorktreeIds,
    cloningProjectIds,
    cloneProgress,
    pendingClaudeSession,
  } = useUiState();
  const creatingWorktreeIdSet = useMemo(() => new Set(creatingWorktreeIds), [creatingWorktreeIds]);
  const cloningProjectIdSet = useMemo(() => new Set(cloningProjectIds), [cloningProjectIds]);
  const tabs = useTabs();
  const tabCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tab of tabs) {
      map[tab.projectItemId] = (map[tab.projectItemId] ?? 0) + 1;
    }
    return map;
  }, [tabs]);
  const [closeTarget, setCloseTarget] = useState<Project | null>(null);
  const [removeWtTarget, setRemoveWtTarget] = useState<{
    projectId: string;
    name: string;
    branch: string;
  } | null>(null);
  const [deletingWtIds, setDeletingWtIds] = useState<Set<string>>(() => new Set());
  const [pendingRenameGroupId, setPendingRenameGroupId] = useState<string | null>(null);

  const agentMap = useProjectAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useProjectPolling(
    allProjects,
    sidebarVisible && pageVisible,
    activeContextId ?? undefined,
  );
  const settings = useSettings();
  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(allProjects, sidebarVisible && pageVisible, githubConnected);
  const navigate = useNavigate();

  // Group-level DnD
  const groupSensors = useDragSensors();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  useDragStyle(activeGroupId !== null);
  const groupListRef = useRef<HTMLDivElement>(null);
  const { snapshot: groupFlipSnapshot } = useFlipAnimation(groupListRef, 'vertical');
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  const handleGroupDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      groupFlipSnapshot();
      setActiveGroupId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = groups.findIndex((g) => g.id === active.id);
      const newIndex = groups.findIndex((g) => g.id === over.id);
      const reordered = arrayMove(groups, oldIndex, newIndex);
      reorderGroups(reordered.map((g) => g.id));
    },
    [groups, groupFlipSnapshot],
  );

  // Ungrouped DnD
  const ungroupedSensors = useDragSensors();
  const [activeUngroupedId, setActiveUngroupedId] = useState<string | null>(null);
  useDragStyle(activeUngroupedId !== null);
  const ungroupedProjectListRef = useRef<HTMLDivElement>(null);
  const { snapshot: ungroupedFlipSnapshot } = useFlipAnimation(ungroupedProjectListRef, 'vertical');
  const ungroupedProjectIds = useMemo(
    () => ungroupedProjects.map((p) => p.id),
    [ungroupedProjects],
  );
  const ungroupedSeparatorIds = useMemo(
    () => new Set(ungroupedProjects.slice(1).map((p) => p.id)),
    [ungroupedProjects],
  );

  const handleUngroupedDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      ungroupedFlipSnapshot();
      setActiveUngroupedId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = ungroupedProjects.findIndex((p) => p.id === active.id);
      const newIndex = ungroupedProjects.findIndex((p) => p.id === over.id);
      const reordered = arrayMove(ungroupedProjects, oldIndex, newIndex);
      reorderProjects(reordered.map((p) => p.id));
    },
    [ungroupedProjects, ungroupedFlipSnapshot],
  );

  const handleRequestOpenPalette = useCallback((ws: Project) => {
    openProjectPalette(makeProjectPaletteItem(ws));
  }, []);

  const handleSelectItem = useCallback(
    (itemId: string) => selectProjectItem(itemId, navigate),
    [navigate],
  );

  const handleAddGroup = useCallback(() => {
    const id = createGroup('New group');
    setPendingRenameGroupId(id);
  }, []);

  // Shared props passed to every RepoTreeItem (whether inside a group or ungrouped).
  const sharedRepoProps = useMemo(
    () => ({
      agentMap,
      tabCounts: tabCountMap,
      onRequestOpenPalette: handleRequestOpenPalette,
      onRequestClose: setCloseTarget,
      selectedItemId,
      activeContextId,
      onSelectItem: handleSelectItem,
      deletingWtIds,
      creatingWorktreeIds: creatingWorktreeIdSet,
      pendingClaudeWorktreeId: pendingClaudeSession?.worktreeId ?? null,
      groups,
    }),
    [
      agentMap,
      tabCountMap,
      handleRequestOpenPalette,
      selectedItemId,
      activeContextId,
      handleSelectItem,
      deletingWtIds,
      creatingWorktreeIdSet,
      pendingClaudeSession,
      groups,
    ],
  );

  return (
    <>
      <div className="flex h-10 items-center border-b border-border/20 pr-2 pl-3">
        <span className="flex-1 font-mono text-sm font-medium tracking-widest text-text-faint uppercase">
          Projects
        </span>
        <Tooltip label="New group" placement="right">
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onPress={handleAddGroup}
            aria-label="Add group"
          >
            <Layers size={12} />
          </Button>
        </Tooltip>
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

      {hasGroups && (
        <DndContext
          sensors={groupSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={({ active }) => setActiveGroupId(String(active.id))}
          onDragEnd={handleGroupDragEnd}
          onDragCancel={() => setActiveGroupId(null)}
        >
          <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
            <div ref={groupListRef}>
              {groups.map((group) => (
                <GroupTreeItem
                  key={group.id}
                  group={group}
                  groupProjects={projectsByGroup.get(group.id) ?? []}
                  isRenaming={pendingRenameGroupId === group.id}
                  onRenameEnd={() => setPendingRenameGroupId(null)}
                  diffStatsMap={diffStatsMap}
                  prMap={prMap}
                  cloningProjectIdSet={cloningProjectIdSet}
                  cloneProgressMap={cloneProgress}
                  onRequestRemoveWt={(projectId, name, branch) =>
                    setRemoveWtTarget({ projectId, name, branch })
                  }
                  {...sharedRepoProps}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {(!hasGroups || ungroupedProjects.length > 0) && (
        <>
          {hasGroups && (
            <div className="flex h-7 items-center px-3">
              <span className="font-mono text-xs font-semibold tracking-widest text-text-faint/50 uppercase">
                Ungrouped
              </span>
            </div>
          )}
          <DndContext
            sensors={ungroupedSensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={({ active }) => setActiveUngroupedId(String(active.id))}
            onDragEnd={handleUngroupedDragEnd}
            onDragCancel={() => setActiveUngroupedId(null)}
          >
            <SortableContext items={ungroupedProjectIds} strategy={verticalListSortingStrategy}>
              <div ref={ungroupedProjectListRef}>
                {ungroupedProjects.map((ws) => (
                  <RepoTreeItem
                    key={ws.id}
                    ws={ws}
                    diffStats={diffStatsMap[ws.id]}
                    prStatuses={prMap[ws.id]}
                    hasSeparator={ungroupedSeparatorIds.has(ws.id)}
                    isCloning={cloningProjectIdSet.has(ws.id)}
                    cloneProgress={cloneProgress[ws.id]}
                    isInvalid={ws.invalid}
                    onRequestRemoveWt={(name, branch) =>
                      setRemoveWtTarget({ projectId: ws.id, name, branch })
                    }
                    {...sharedRepoProps}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

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
          branch={removeWtTarget.branch}
          onConfirm={(alsoDeleteGit) => {
            const { projectId, name, branch } = removeWtTarget;
            const itemId = `${projectId}-wt-${name}`;
            setRemoveWtTarget(null);
            closeAllTabs(itemId);

            // If the deleted wt is the active context, redirect to the first remaining item.
            if (activeContextId === itemId) {
              const ws = allProjects.find((w) => w.id === projectId);
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
                  if (branch) void deleteBranch(projectId, branch);
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
  isCloning,
  cloneProgress,
  isInvalid,
  pendingClaudeWorktreeId,
  groups,
}: {
  ws: Project;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  prStatuses?: Record<string, PrInfo>;
  tabCounts: Record<string, number>;
  onRequestOpenPalette: (ws: Project) => void;
  onRequestClose: (ws: Project) => void;
  onRequestRemoveWt: (name: string, branch: string) => void;
  selectedItemId: string | null;
  activeContextId: string | null;
  hasSeparator: boolean;
  onSelectItem: (itemId: string) => void;
  deletingWtIds: Set<string>;
  creatingWorktreeIds: Set<string>;
  isCloning: boolean;
  cloneProgress?: CloneProgress;
  isInvalid: boolean;
  pendingClaudeWorktreeId: string | null;
  groups: Group[];
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
  const [renamingWtName, setRenamingWtName] = useState<string | null>(null);
  const [itemMenu, setItemMenu] = useState<{
    kind: 'branch' | 'wt';
    name: string;
    x: number;
    y: number;
  } | null>(null);

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

  const localCreatingIds = [...creatingWorktreeIds].filter((id) => id.startsWith(`${ws.id}-wt-`));
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
          isCloning={isCloning}
          cloneProgress={cloneProgress}
          isInvalid={isInvalid}
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
                  className={sidebarItem({ selected: selectedItemId === itemId })}
                  onClick={() => onSelectItem(itemId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setItemMenu({ kind: 'branch', name: b.name, x: e.clientX, y: e.clientY });
                  }}
                >
                  <BranchRow
                    branch={b}
                    agentStatus={agentMap[itemId]}
                    diffStat={diffStats?.[b.name]}
                    prInfo={prStatuses?.[b.name]}
                    isSelected={selectedItemId === itemId}
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
                    className={sidebarItem({
                      selected: selectedItemId === itemId,
                      deleting: isDeleting,
                    })}
                    onClick={() => !isDeleting && onSelectItem(itemId)}
                    onContextMenu={(e) => {
                      if (isDeleting) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setItemMenu({ kind: 'wt', name: wt.name, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <WorktreeRow
                      worktree={wt}
                      projectId={ws.id}
                      agentStatus={agentMap[itemId]}
                      diffStat={diffStats?.[wt.branch]}
                      isDeleting={isDeleting}
                      prInfo={prStatuses?.[wt.branch]}
                      isSelected={selectedItemId === itemId}
                      tabCount={tabCounts[itemId]}
                      isRenaming={renamingWtName === wt.name}
                      onRenameEnd={() => setRenamingWtName(null)}
                    />
                  </div>
                );
              })}
            {ws.branches.length === 0 &&
              ws.worktrees.length === 0 &&
              !isCloning &&
              localCreatingIds.length === 0 && (
                <div className="py-1.5 pr-3 pl-11 font-mono text-xs text-text-faint/40">
                  no branches
                </div>
              )}
            {localCreatingIds.map((id) => {
              const name = id.slice(`${ws.id}-wt-`.length);
              const isSelected = selectedItemId === id;
              const hasPendingClaude = pendingClaudeWorktreeId === id;
              return (
                <div
                  key={id}
                  className={sidebarItem({ selected: isSelected })}
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
                      {hasPendingClaude && (
                        <ClaudeCodeIcon size={11} className="shrink-0 text-[#da7756]/60" />
                      )}
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
              ...(groups.length > 0
                ? [
                    {
                      type: 'submenu' as const,
                      label: 'Move to group',
                      icon: <Layers size={13} />,
                      items: [
                        {
                          label: 'No group',
                          checked: !ws.groupId,
                          onSelect: () => assignProjectToGroup(ws.id, null),
                        },
                        { type: 'separator' as const },
                        ...groups.map((g) => ({
                          label: g.name,
                          checked: ws.groupId === g.id,
                          onSelect: () => assignProjectToGroup(ws.id, g.id),
                        })),
                      ] satisfies ContextMenuItemDef[],
                    },
                  ]
                : []),
              {
                label: 'Close project',
                icon: <FolderX size={13} />,
                destructive: true,
                disabled: isCloning,
                onSelect: () => {
                  setMenuOpen(false);
                  onRequestClose(ws);
                },
              },
            ] satisfies ContextMenuItemDef[]
          }
        />
      )}
      {itemMenu &&
        (() => {
          const isWt = itemMenu.kind === 'wt';
          const wt = isWt ? ws.worktrees.find((w) => w.name === itemMenu.name) : null;
          const path = isWt ? (wt?.path ?? ws.path) : ws.path;
          const branchName = isWt ? (wt?.branch ?? '') : itemMenu.name;
          const close = () => setItemMenu(null);
          return (
            <ContextMenu
              x={itemMenu.x}
              y={itemMenu.y}
              onClose={close}
              items={[
                {
                  label: 'Reveal in Finder',
                  icon: <FolderOpen size={13} />,
                  onSelect: () => {
                    close();
                    void revealItemInDir(path);
                  },
                },
                ...(isWt
                  ? [
                      {
                        label: 'Rename',
                        icon: <Pencil size={13} />,
                        onSelect: () => {
                          close();
                          setRenamingWtName(itemMenu.name);
                        },
                      },
                    ]
                  : []),
                {
                  type: 'submenu' as const,
                  label: 'Copy',
                  icon: <Copy size={13} />,
                  items: [
                    {
                      label: 'Path',
                      onSelect: () => {
                        close();
                        void navigator.clipboard.writeText(path);
                      },
                    },
                    {
                      label: 'Branch',
                      onSelect: () => {
                        close();
                        void navigator.clipboard.writeText(branchName);
                      },
                    },
                  ],
                },
                ...(isWt
                  ? [
                      {
                        label: 'Close worktree',
                        icon: <GitBranchMinus size={13} />,
                        destructive: true,
                        onSelect: () => {
                          close();
                          onRequestRemoveWt(itemMenu.name, wt?.branch ?? '');
                        },
                      },
                    ]
                  : []),
              ]}
            />
          );
        })()}
    </>
  );
}
