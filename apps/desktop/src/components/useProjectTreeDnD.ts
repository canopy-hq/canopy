import { useState, useRef, useCallback, useMemo } from 'react';
import type { RefObject } from 'react';

import {
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DroppableContainer,
  type Modifier,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import { restrictToMinTop, restrictToVerticalAxis } from '../lib/dnd';
import { assignProjectToGroup, reorderGroups, toggleGroupCollapsed } from '../lib/group-actions';
import { reorderProjects } from '../lib/project-actions';

import type { Group, Project } from '@superagent/db';

export type ActiveDragInfo =
  | { type: 'group'; id: string; name: string }
  | { type: 'project'; id: string; name: string; firstLetter: string; groupId: string | null };

export function useProjectTreeDnD({
  groups,
  allProjects,
  projectsByGroup,
  ungroupedProjects,
  headerRef,
  groupFlipSnapshot,
}: {
  groups: Group[];
  allProjects: Project[];
  projectsByGroup: Map<string | null, Project[]>;
  ungroupedProjects: Project[];
  headerRef: RefObject<HTMLDivElement | null>;
  groupFlipSnapshot: () => void;
}): {
  activeDrag: ActiveDragInfo | null;
  overGroupId: string | null;
  effectiveSortedByGroup: Map<string | null, Project[]>;
  collisionDetection: CollisionDetection;
  modifiers: Modifier[];
  handleDragStart: (e: DragStartEvent) => void;
  handleDragOver: (e: DragOverEvent) => void;
  handleDragEnd: (e: DragEndEvent) => void;
  handleDragCancel: () => void;
} {
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const activeDragRef = useRef<ActiveDragInfo | null>(null);
  const [overGroupId, setOverGroupId] = useState<string | null>(null);
  // Live draft ordering during cross-group drags (null = use DB data)
  const [draftGroupItems, setDraftGroupItems] = useState<Map<string | null, string[]> | null>(null);
  const draftGroupItemsRef = useRef<Map<string | null, string[]> | null>(null);
  const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Cached at drag-start to avoid getBoundingClientRect on every pointer move.
  const headerBottomRef = useRef(0);

  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  const restrictAboveHeader = useMemo(() => restrictToMinTop(() => headerBottomRef.current), []);
  const modifiers = useMemo<Modifier[]>(
    () => [restrictToVerticalAxis, restrictAboveHeader],
    [restrictAboveHeader],
  );

  // Uses draft during active drag for live cross-group preview; DB data otherwise.
  const effectiveSortedByGroup = useMemo(() => {
    const result = new Map<string | null, Project[]>();
    if (draftGroupItems) {
      for (const [groupId, ids] of draftGroupItems) {
        const projects = ids
          .map((id) => allProjects.find((p) => p.id === id))
          .filter(Boolean) as Project[];
        result.set(groupId, projects);
      }
    } else {
      result.set(null, ungroupedProjects);
      for (const g of groups) {
        result.set(
          g.id,
          [...(projectsByGroup.get(g.id) ?? [])].sort((a, b) => a.position - b.position),
        );
      }
    }
    return result;
  }, [draftGroupItems, allProjects, ungroupedProjects, projectsByGroup, groups]);

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      // When dragging a group, only collide with other groups — not projects.
      const current = activeDragRef.current;
      if (current?.type === 'group') {
        const groupContainers = args.droppableContainers.filter((c: DroppableContainer) =>
          groupIds.includes(String(c.id)),
        );
        return closestCenter({ ...args, droppableContainers: groupContainers });
      }
      return closestCenter(args);
    },
    [groupIds],
  );

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const data = active.data.current as
        | { type: 'group' | 'project'; groupId?: string | null }
        | undefined;
      let info: ActiveDragInfo;
      if (data?.type === 'group') {
        const group = groups.find((g) => g.id === active.id);
        info = { type: 'group', id: String(active.id), name: group?.name ?? '' };
      } else {
        const project = allProjects.find((p) => p.id === active.id);
        info = {
          type: 'project',
          id: String(active.id),
          name: project?.name ?? '',
          firstLetter: (project?.name ?? '?').charAt(0).toUpperCase(),
          groupId: data?.groupId ?? project?.groupId ?? null,
        };
      }
      activeDragRef.current = info;
      setActiveDrag(info);
      headerBottomRef.current = headerRef.current?.getBoundingClientRect().bottom ?? 0;

      if (info.type === 'project') {
        const draft = new Map<string | null, string[]>();
        draft.set(
          null,
          [...(projectsByGroup.get(null) ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((p) => p.id),
        );
        for (const g of groups) {
          draft.set(
            g.id,
            [...(projectsByGroup.get(g.id) ?? [])]
              .sort((a, b) => a.position - b.position)
              .map((p) => p.id),
          );
        }
        draftGroupItemsRef.current = draft;
        setDraftGroupItems(draft);
      }
    },
    [groups, allProjects, projectsByGroup, headerRef],
  );

  const handleDragOver = useCallback(
    ({ over }: DragOverEvent) => {
      const current = activeDragRef.current;
      if (current?.type !== 'project') {
        setOverGroupId(null);
        return;
      }
      const overId = over ? String(over.id) : null;
      const isOverGroup = overId ? groups.some((g) => g.id === overId) : false;
      const newOverGroupId = isOverGroup ? overId : null;
      const isOverProject =
        overId && !isOverGroup && overId !== 'ungrouped-drop'
          ? allProjects.some((p) => p.id === overId)
          : false;

      setOverGroupId((prev) => {
        if (prev !== newOverGroupId) {
          clearTimeout(autoExpandTimer.current);
          if (newOverGroupId) {
            autoExpandTimer.current = setTimeout(() => {
              const group = groups.find((g) => g.id === newOverGroupId);
              if (group?.collapsed) toggleGroupCollapsed(newOverGroupId);
            }, 600);
          }
        }
        return newOverGroupId;
      });

      if (isOverProject && overId && overId !== current.id) {
        const overProject = allProjects.find((p) => p.id === overId);
        if (!overProject) return;
        const targetGroupId = overProject.groupId ?? null;
        const activeId = current.id;
        const prev = draftGroupItemsRef.current;
        if (!prev) return;

        let currentDraftGroup: string | null | undefined;
        for (const [gid, ids] of prev) {
          if (ids.includes(activeId)) {
            currentDraftGroup = gid;
            break;
          }
        }

        const draft = new Map(prev);

        if (currentDraftGroup === targetGroupId) {
          // Same group in draft: reposition using arrayMove (matches dnd-kit's transform logic)
          const currentIds = [...(draft.get(targetGroupId) ?? [])];
          const activeIdx = currentIds.indexOf(activeId);
          const overIdx = currentIds.indexOf(overId);
          if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return;
          draft.set(targetGroupId, arrayMove(currentIds, activeIdx, overIdx));
        } else {
          if (currentDraftGroup !== undefined) {
            draft.set(
              currentDraftGroup,
              prev.get(currentDraftGroup)!.filter((id) => id !== activeId),
            );
          }
          const targetIds = [...(draft.get(targetGroupId) ?? [])];
          const insertIndex = targetIds.indexOf(overId);
          if (insertIndex === -1) return;
          targetIds.splice(insertIndex, 0, activeId);
          draft.set(targetGroupId, targetIds);
        }

        draftGroupItemsRef.current = draft;
        setDraftGroupItems(draft);
      }
    },
    [groups, allProjects],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      clearTimeout(autoExpandTimer.current);
      setOverGroupId(null);
      const draft = draftGroupItemsRef.current;
      draftGroupItemsRef.current = null;
      setDraftGroupItems(null);
      const current = activeDragRef.current;
      activeDragRef.current = null;
      setActiveDrag(null);

      const activeId = String(active.id);

      if (current?.type === 'group') {
        if (!over) return;
        const overId = String(over.id);
        if (activeId === overId) return;
        groupFlipSnapshot();
        const oldIndex = groups.findIndex((g) => g.id === activeId);
        const newIndex = groups.findIndex((g) => g.id === overId);
        if (oldIndex === -1 || newIndex === -1) return;
        reorderGroups(arrayMove(groups, oldIndex, newIndex).map((g) => g.id));
        return;
      }

      if (current?.type === 'project') {
        const overId = over ? String(over.id) : null;

        if (overId === 'ungrouped-drop') {
          assignProjectToGroup(activeId, null);
          return;
        }

        const activeProject = allProjects.find((p) => p.id === activeId);
        if (!activeProject) return;
        const originalGroupId = activeProject.groupId ?? null;

        // Trust the draft for cross-group moves: the live preview IS the intended position.
        // The user can drop anywhere (not just on a specific project title) and the project
        // lands where the preview showed it.
        if (draft) {
          let finalGroupId: string | null | undefined;
          let finalIds: string[] | undefined;
          for (const [gid, ids] of draft) {
            if (ids.includes(activeId)) {
              finalGroupId = gid;
              finalIds = ids;
              break;
            }
          }
          if (finalGroupId !== undefined && finalIds) {
            if (finalGroupId !== originalGroupId) {
              assignProjectToGroup(activeId, finalGroupId);
              reorderProjects(finalIds);
              return;
            }
            // Drop on a different group header (e.g. empty group) → assign to it
            if (overId) {
              const overGroup = groups.find((g) => g.id === overId);
              if (overGroup && overGroup.id !== originalGroupId) {
                assignProjectToGroup(activeId, overGroup.id);
                return;
              }
            }
            // Same group: if over a specific project use arrayMove, else commit draft order
            if (overId && overId !== activeId) {
              const overProject = allProjects.find((p) => p.id === overId);
              if (overProject && (overProject.groupId ?? null) === originalGroupId) {
                const list =
                  originalGroupId === null
                    ? ungroupedProjects
                    : [...(projectsByGroup.get(originalGroupId) ?? [])].sort(
                        (a, b) => a.position - b.position,
                      );
                const oldIndex = list.findIndex((p) => p.id === activeId);
                const newIndex = list.findIndex((p) => p.id === overId);
                if (oldIndex !== -1 && newIndex !== -1) {
                  reorderProjects(arrayMove(list, oldIndex, newIndex).map((p) => p.id));
                  return;
                }
              }
            }
            reorderProjects(finalIds);
            return;
          }
        }

        if (!over) {
          if (originalGroupId !== null) assignProjectToGroup(activeId, null);
          return;
        }

        const overId2 = String(over.id);
        const overGroup = groups.find((g) => g.id === overId2);
        if (overGroup) {
          assignProjectToGroup(activeId, overId2);
          return;
        }

        if (activeId === overId2) return;
        const overProject = allProjects.find((p) => p.id === overId2);
        if (!overProject) return;
        const overGroupId = overProject.groupId ?? null;

        if (originalGroupId === overGroupId) {
          const list =
            originalGroupId === null
              ? ungroupedProjects
              : [...(projectsByGroup.get(originalGroupId) ?? [])].sort(
                  (a, b) => a.position - b.position,
                );
          const oldIndex = list.findIndex((p) => p.id === activeId);
          const newIndex = list.findIndex((p) => p.id === overId2);
          if (oldIndex === -1 || newIndex === -1) return;
          reorderProjects(arrayMove(list, oldIndex, newIndex).map((p) => p.id));
        } else {
          const targetList = (
            overGroupId === null
              ? ungroupedProjects
              : [...(projectsByGroup.get(overGroupId) ?? [])].sort(
                  (a, b) => a.position - b.position,
                )
          ).filter((p) => p.id !== activeId);
          const insertIndex = targetList.findIndex((p) => p.id === overId2);
          if (insertIndex === -1) return;
          targetList.splice(insertIndex, 0, activeProject);
          assignProjectToGroup(activeId, overGroupId);
          reorderProjects(targetList.map((p) => p.id));
        }
      }
    },
    [groups, allProjects, ungroupedProjects, projectsByGroup, groupFlipSnapshot],
  );

  const handleDragCancel = useCallback(() => {
    clearTimeout(autoExpandTimer.current);
    activeDragRef.current = null;
    setActiveDrag(null);
    setOverGroupId(null);
    draftGroupItemsRef.current = null;
    setDraftGroupItems(null);
  }, []);

  return {
    activeDrag,
    overGroupId,
    effectiveSortedByGroup,
    collisionDetection,
    modifiers,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
