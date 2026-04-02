import { getWorkspaceCollection, getTabCollection, uiCollection, getUiState, setSetting } from '@superagent/db';
import * as gitApi from './git';
import { showErrorToast } from './toast';
import { setActiveContext } from './tab-actions';
import { collectLeafPtyIds } from './pane-tree-ops';
import { closePty } from './pty';
import { disposeCached } from './terminal-cache';

export async function importRepo(path: string): Promise<void> {
  try {
    const info = await gitApi.importRepo(path);
    const collection = getWorkspaceCollection();
    collection.insert({
      id: crypto.randomUUID(),
      path: info.path,
      name: info.name,
      branches: info.branches,
      worktrees: info.worktrees,
      expanded: true,
      position: collection.toArray.length,
    });
    uiCollection.update('ui', (draft) => {
      draft.sidebarVisible = true;
    });
    setSetting('sidebarVisible', true);
  } catch (err) {
    showErrorToast('Import failed', String(err));
  }
}

export async function closeProject(id: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === id);
  if (!ws) return;

  // Collect all workspace item IDs (repo + branches + worktrees)
  const itemIds = new Set<string>();
  itemIds.add(ws.id);
  for (const b of ws.branches) itemIds.add(`${ws.id}-branch-${b.name}`);
  for (const wt of ws.worktrees) itemIds.add(`${ws.id}-wt-${wt.name}`);

  // Find all tabs belonging to this workspace
  const tabCol = getTabCollection();
  const tabs = tabCol.toArray.filter((t) => itemIds.has(t.workspaceItemId));

  // Kill all PTYs and dispose terminal caches
  const ptyIds = tabs.flatMap((t) => collectLeafPtyIds(t.paneRoot));
  await Promise.allSettled(
    ptyIds.map(async (ptyId) => {
      disposeCached(ptyId);
      await closePty(ptyId);
    }),
  );

  // Delete all tabs for this workspace
  for (const tab of tabs) {
    tabCol.delete(tab.id);
  }

  // If active context belongs to this workspace, clear it
  const ui = getUiState();
  if (itemIds.has(ui.activeContextId)) {
    uiCollection.update('ui', (draft) => {
      draft.activeContextId = '';
      draft.activeTabId = '';
      draft.selectedItemId = null;
    });
    setSetting('activeContextId', '');
    setSetting('activeTabId', '');
  }

  // Remove workspace from collection
  getWorkspaceCollection().delete(id);
}

export async function refreshRepo(id: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === id);
  if (!ws) return;
  try {
    const info = await gitApi.importRepo(ws.path);
    getWorkspaceCollection().update(id, (draft) => {
      draft.branches = info.branches;
      draft.worktrees = info.worktrees;
    });
  } catch (err) {
    showErrorToast('Refresh failed', String(err));
  }
}

export function toggleExpanded(id: string): void {
  getWorkspaceCollection().update(id, (draft) => {
    draft.expanded = !draft.expanded;
  });
}

export function setSelectedItem(itemId: string | null): void {
  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = itemId;
  });
}

export function selectWorkspaceItem(itemId: string | null, itemLabel?: string): void {
  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = itemId;
  });
  if (itemId !== null && itemLabel) {
    setActiveContext(itemId, itemLabel);
  } else if (itemId === null) {
    setActiveContext('');
  }
}

export function toggleSidebar(): void {
  const newVisible = !getUiState().sidebarVisible;
  uiCollection.update('ui', (draft) => {
    draft.sidebarVisible = newVisible;
  });
  setSetting('sidebarVisible', newVisible);
}

export function setSidebarWidth(width: number): void {
  uiCollection.update('ui', (draft) => {
    draft.sidebarWidth = Math.max(180, Math.min(400, width));
  });
}

export async function createBranch(workspaceId: string, name: string, base: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.createBranch(ws.path, name, base);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast('Create branch failed', String(err));
  }
}

export async function deleteBranch(workspaceId: string, name: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.deleteBranch(ws.path, name);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast('Delete branch failed', String(err));
  }
}

export async function createWorktree(
  workspaceId: string,
  name: string,
  path: string,
  baseBranch?: string,
): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.createWorktree(ws.path, name, path, baseBranch);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast('Create worktree failed', String(err));
  }
}

export async function removeWorktree(workspaceId: string, name: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.removeWorktree(ws.path, name);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast('Remove worktree failed', String(err));
  }
}
