import { getGroupCollection, getProjectCollection } from '@canopy/db';

export function createGroup(name: string): string {
  const col = getGroupCollection();
  const id = crypto.randomUUID();
  col.insert({
    id,
    name: name.trim() || 'New group',
    position: col.toArray.length,
    collapsed: false,
  });
  return id;
}

export function deleteGroup(id: string): void {
  const projCol = getProjectCollection();
  for (const proj of projCol.toArray) {
    if (proj.groupId === id) {
      projCol.update(proj.id, (draft) => {
        draft.groupId = null;
      });
    }
  }
  getGroupCollection().delete(id);
}

export function renameGroup(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getGroupCollection().update(id, (draft) => {
    draft.name = trimmed;
  });
}

export function toggleGroupCollapsed(id: string): void {
  getGroupCollection().update(id, (draft) => {
    draft.collapsed = !draft.collapsed;
  });
}

export function reorderGroups(orderedIds: string[]): void {
  const col = getGroupCollection();
  for (let i = 0; i < orderedIds.length; i++) {
    col.update(orderedIds[i], (draft) => {
      draft.position = i;
    });
  }
}

export function assignProjectToGroup(projectId: string, groupId: string | null): void {
  getProjectCollection().update(projectId, (draft) => {
    draft.groupId = groupId;
  });
}
