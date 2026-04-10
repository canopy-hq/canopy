import { useState, useEffect, useMemo, useRef, memo } from 'react';

import { useDroppable, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, ContextMenu } from '@superagent/ui';
import { ChevronDown, ChevronRight, FolderX, GripVertical, Pencil } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { useDropping } from '../hooks/useDropping';
import { sortableTransition } from '../lib/dnd';
import { deleteGroup, renameGroup, toggleGroupCollapsed } from '../lib/group-actions';
import { RepoTreeItem } from './RepoTreeItem';

import type { DiffStat } from '../lib/git';
import type { PrInfo } from '../lib/github';
import type { Group, Project, CloneProgress } from '@superagent/db';
import type { ContextMenuItemDef, DotStatus } from '@superagent/ui';

const groupHeaderRow = tv({
  base: 'flex items-center gap-2 py-1 pl-3 pr-2 select-none transition-colors border-y border-transparent',
  variants: { isDropTarget: { true: 'border-accent/25 bg-accent/8' } },
});

const GroupHeader = memo(
  function GroupHeader({
    group,
    isRenaming,
    projectCount,
    isDropTarget,
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
    isDropTarget?: boolean;
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
        className={groupHeaderRow({ isDropTarget })}
        onClick={isRenaming ? undefined : () => onToggleCollapse()}
        onContextMenu={isRenaming ? undefined : onContextMenu}
        {...(isRenaming ? {} : dragListeners)}
      >
        <div
          className="flex w-6 shrink-0 items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical
            size={11}
            className="cursor-grab touch-none text-text-faint/30 active:cursor-grabbing"
          />
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
    prev.isDropTarget === next.isDropTarget &&
    prev.projectCount === next.projectCount &&
    prev.onStartRename === next.onStartRename &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.dragListeners === next.dragListeners,
);

export function UngroupedDropZone({ visible, isActive }: { visible: boolean; isActive?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'ungrouped-drop' });

  if (!visible) return null;

  return (
    <div
      ref={setNodeRef}
      className={`mx-2 my-1 rounded border border-dashed px-3 font-mono text-xs transition-all duration-150 ${
        isOver || isActive
          ? 'border-accent/40 bg-accent/8 py-3 text-accent/60'
          : 'border-border/25 py-1.5 text-text-faint/35'
      }`}
    >
      Drop here to remove from group
    </div>
  );
}

export function GroupTreeItem({
  group,
  groupProjects,
  isRenaming: isExternalRenaming,
  isDropTarget,
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
  isDropTarget?: boolean;
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
    data: { type: 'group' },
    transition: sortableTransition,
  });
  const isDropping = useDropping(isDragging, 220);

  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (isExternalRenaming && !renaming) setRenaming(true);
  }, [isExternalRenaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const [menuOpen, setMenuOpen] = useState(false);
  const menuPos = useRef({ x: 0, y: 0 });

  const projectIds = useMemo(() => groupProjects.map((p) => p.id), [groupProjects]);
  const separatorIds = useMemo(
    () => new Set(groupProjects.slice(1).map((p) => p.id)),
    [groupProjects],
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
          opacity: isDragging ? 0 : 1,
        }}
      >
        <GroupHeader
          group={group}
          isRenaming={renaming}
          isDropTarget={isDropTarget}
          projectCount={groupProjects.length}
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
          <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
            <div>
              {groupProjects.map((ws) => (
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
