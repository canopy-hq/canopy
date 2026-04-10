import { useState, useRef, useCallback, useMemo } from 'react';

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { getSetting } from '@superagent/db';
import { Button, Kbd, Tooltip } from '@superagent/ui';
import { useNavigate } from '@tanstack/react-router';
import { FolderPlus, GripVertical, Layers } from 'lucide-react';

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
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { usePageVisible } from '../hooks/usePageVisible';
import { useProjectPolling } from '../hooks/useProjectPolling';
import { usePrPolling } from '../hooks/usePrPolling';
import { useDragSensors } from '../lib/dnd';
import { GITHUB_CONNECTION_KEY } from '../lib/github';
import { createGroup } from '../lib/group-actions';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  selectProjectItem,
  closeProject,
  hideWorktree,
  removeWorktree,
  deleteBranch,
} from '../lib/project-actions';
import { openProjectPalette } from '../lib/project-palette-bridge';
import { closeAllTabs } from '../lib/tab-actions';
import { CloseProjectModal } from './CloseProjectModal';
import { GroupTreeItem, UngroupedDropZone } from './GroupTreeItem';
import { RemoveWorktreeModal } from './RemoveWorktreeModal';
import { RepoTreeItem } from './RepoTreeItem';
import { useProjectTreeDnD } from './useProjectTreeDnD';

import type { Project } from '@superagent/db';
import type { DotStatus } from '@superagent/ui';

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
    rawProjects,
    sidebarVisible && pageVisible,
    activeContextId ?? undefined,
  );
  const settings = useSettings();
  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(rawProjects, sidebarVisible && pageVisible, githubConnected);
  const navigate = useNavigate();

  const sensors = useDragSensors();
  const groupListRef = useRef<HTMLDivElement>(null);
  const { snapshot: groupFlipSnapshot } = useFlipAnimation(groupListRef, 'vertical');
  const headerRef = useRef<HTMLDivElement>(null);

  const {
    activeDrag,
    overGroupId,
    overUngrouped,
    effectiveSortedByGroup,
    collisionDetection,
    modifiers,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useProjectTreeDnD({
    groups,
    allProjects: rawProjects,
    projectsByGroup,
    ungroupedProjects,
    headerRef,
    groupFlipSnapshot,
  });

  useDragStyle(activeDrag !== null);

  const effectiveUngrouped = useMemo(
    () => effectiveSortedByGroup.get(null) ?? [],
    [effectiveSortedByGroup],
  );
  const groupSortableIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const ungroupedProjectIds = useMemo(
    () => effectiveUngrouped.map((p) => p.id),
    [effectiveUngrouped],
  );
  const ungroupedSeparatorIds = useMemo(
    () => new Set(effectiveUngrouped.slice(1).map((p) => p.id)),
    [effectiveUngrouped],
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

  const showUngroupedDropZone = activeDrag?.type === 'project' && activeDrag.groupId !== null;

  return (
    <>
      <div
        ref={headerRef}
        className="flex h-10 items-center gap-2 border-b border-border/20 pr-2 pl-3"
      >
        <span className="flex-1 font-mono text-sm leading-none font-medium tracking-widest text-text-faint uppercase">
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
            <Layers size={14} />
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
              <FolderPlus size={14} />
            </Button>
          </Tooltip>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={modifiers}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {hasGroups && (
          <SortableContext items={groupSortableIds} strategy={verticalListSortingStrategy}>
            <div ref={groupListRef}>
              {groups.map((group) => {
                const groupProjects = effectiveSortedByGroup.get(group.id) ?? [];
                return (
                  <GroupTreeItem
                    key={group.id}
                    group={group}
                    groupProjects={groupProjects}
                    isRenaming={pendingRenameGroupId === group.id}
                    isDropTarget={
                      overGroupId === group.id && (group.collapsed || groupProjects.length === 0)
                    }
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
                );
              })}
            </div>
          </SortableContext>
        )}

        {(!hasGroups || effectiveUngrouped.length > 0 || showUngroupedDropZone) && (
          <>
            {hasGroups && (
              <div className="flex h-7 items-center px-3">
                <span className="font-mono text-xs leading-none font-semibold tracking-widest text-text-faint/50 uppercase">
                  Ungrouped
                </span>
              </div>
            )}
            <UngroupedDropZone visible={showUngroupedDropZone} isActive={overUngrouped} />
            <SortableContext items={ungroupedProjectIds} strategy={verticalListSortingStrategy}>
              <div>
                {effectiveUngrouped.map((ws) => (
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
          </>
        )}

        <DragOverlay>
          {activeDrag?.type === 'group' &&
            (() => {
              const overlayGroup = groups.find((g) => g.id === activeDrag.id);
              const overlayProjects = overlayGroup
                ? [...(projectsByGroup.get(activeDrag.id) ?? [])].sort(
                    (a, b) => a.position - b.position,
                  )
                : [];
              return (
                <div className="border-y border-border/30 bg-bg-secondary shadow-xl">
                  <div className="flex items-center gap-2 py-1 pr-2 pl-3">
                    <div className="flex w-6 shrink-0 items-center justify-center">
                      <GripVertical size={11} className="text-text-faint/30" />
                    </div>
                    <span className="flex-1 font-mono text-xs font-semibold tracking-widest text-text-faint uppercase">
                      {activeDrag.name}
                    </span>
                    <div className="h-7 w-7" />
                  </div>
                  {!overlayGroup?.collapsed &&
                    overlayProjects.map((ws) => (
                      <div
                        key={ws.id}
                        className="flex items-center gap-2 bg-bg-primary py-1.5 pr-2 pl-3 brightness-[1.6]"
                      >
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-sm leading-none font-medium"
                          style={
                            ws.color
                              ? {
                                  color: `color-mix(in srgb, ${ws.color} 40%, var(--text-faint))`,
                                  borderColor: 'transparent',
                                  backgroundColor: `color-mix(in srgb, ${ws.color} 8%, var(--bg-secondary))`,
                                }
                              : {
                                  color: 'var(--text-faint)',
                                  borderColor: 'transparent',
                                  backgroundColor:
                                    'color-mix(in srgb, var(--bg-tertiary) 60%, var(--bg-secondary))',
                                }
                          }
                        >
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="min-w-0 flex-1 truncate font-mono text-lg font-medium text-text-primary">
                          {ws.name}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })()}
          {activeDrag?.type === 'project' && (
            <div className="flex items-center gap-2 border-y border-border/20 bg-bg-secondary px-3 py-1.5 shadow-lg">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent bg-bg-tertiary text-sm leading-none font-medium text-text-faint">
                {activeDrag.firstLetter}
              </div>
              <span className="font-mono text-lg font-medium text-text-primary">
                {activeDrag.name}
              </span>
            </div>
          )}
        </DragOverlay>
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
          branch={removeWtTarget.branch}
          onConfirm={(alsoDeleteGit) => {
            const { projectId, name, branch } = removeWtTarget;
            const itemId = `${projectId}-wt-${name}`;
            setRemoveWtTarget(null);
            closeAllTabs(itemId);

            // If the deleted wt is the active context, redirect to the first remaining item.
            if (activeContextId === itemId) {
              const ws = rawProjects.find((w) => w.id === projectId);
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
