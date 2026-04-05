import {
  getWorkspaceCollection,
  getTabCollection,
  uiCollection,
  getUiState,
  getSetting,
  setSetting,
  getSettingCollection,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from '@superagent/db';
import { closePty, closePtysForPanes, disposeCached } from '@superagent/terminal';

import * as gitApi from './git';
import { collectAllLeafPaneIds, collectLeafPtyIds } from './pane-tree-ops';
import { closeTab } from './tab-actions';
import { showErrorToast, showInfoToast } from './toast';

import type { Workspace } from '@superagent/db';

/** Returns true for branch/worktree IDs — the only items that carry selection state. */
export function isSelectableWorkspaceItem(id: string): boolean {
  return id.includes('-branch-') || id.includes('-wt-');
}

/** All sidebar item IDs for a workspace (repo root + branches + worktrees). */
export function getWorkspaceItemIds(ws: Workspace): Set<string> {
  const ids = new Set<string>();
  ids.add(ws.id);
  for (const b of ws.branches) ids.add(`${ws.id}-branch-${b.name}`);
  for (const wt of ws.worktrees) ids.add(`${ws.id}-wt-${wt.name}`);
  return ids;
}

export async function importRepo(path: string): Promise<void> {
  try {
    const info = await gitApi.importRepo(path);
    const collection = getWorkspaceCollection();

    const existing = collection.toArray.find((w) => w.path === info.path);
    if (existing) {
      showInfoToast(`"${existing.name}" is already imported`);
    } else {
      collection.insert({
        id: crypto.randomUUID(),
        path: info.path,
        name: info.name,
        branches: info.branches,
        worktrees: info.worktrees,
        expanded: true,
        position: collection.toArray.length,
      });
    }

    uiCollection.update('ui', (draft) => {
      draft.sidebarVisible = true;
    });
  } catch (err) {
    showErrorToast('Import failed', String(err));
  }
}

export async function closeProject(
  id: string,
  navigate: (opts: { to: string }) => void,
): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === id);
  if (!ws) return;

  const itemIds = getWorkspaceItemIds(ws);

  const tabCol = getTabCollection();
  const tabs = tabCol.toArray.filter((t) => itemIds.has(t.workspaceItemId));

  const ptyIds = tabs.flatMap((t) => collectLeafPtyIds(t.paneRoot));
  await Promise.allSettled(
    ptyIds.map(async (ptyId) => {
      disposeCached(ptyId);
      await closePty(ptyId);
    }),
  );

  // Catch-all: close any PTYs spawned for these panes that weren't in the
  // pane tree yet (e.g. startup restore race).
  const allPaneIds = tabs.flatMap((t) => collectAllLeafPaneIds(t.paneRoot));
  await closePtysForPanes(allPaneIds).catch(() => {});

  for (const tab of tabs) {
    tabCol.delete(tab.id);
  }

  const ui = getUiState();
  if (itemIds.has(ui.activeContextId)) {
    uiCollection.update('ui', (draft) => {
      draft.activeContextId = '';
      draft.activeTabId = '';
      draft.selectedItemId = null;
    });
    navigate({ to: '/' });
  }

  getWorkspaceCollection().delete(id);
}

export async function refreshRepo(id: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === id);
  if (!ws) return;
  try {
    const info = await gitApi.importRepo(ws.path);
    getWorkspaceCollection().update(id, (draft) => {
      draft.branches = info.branches;
      // Don't overwrite worktrees — import_repo returns [] now,
      // but we want to keep user-opened worktrees in the sidebar.
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

const RECENT_MAX = 10;

function trackRecentWorkspace(itemId: string): void {
  // Extract workspace ID from composite item IDs (e.g. "ws-id-branch-main" → "ws-id")
  const ws = getWorkspaceCollection().toArray.find(
    (w) =>
      itemId === w.id || itemId.startsWith(`${w.id}-branch-`) || itemId.startsWith(`${w.id}-wt-`),
  );
  if (!ws) return;

  const settings = getSettingCollection().toArray;
  const current = getSetting<string[]>(settings, 'recentWorkspaceIds', []);
  const updated = [ws.id, ...current.filter((id) => id !== ws.id)].slice(0, RECENT_MAX);
  setSetting('recentWorkspaceIds', updated);
}

export function selectWorkspaceItem(
  itemId: string | null,
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = itemId;
  });
  if (itemId !== null) {
    trackRecentWorkspace(itemId);
    navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: itemId } });
  } else {
    navigate({ to: '/' });
  }
}

/**
 * Switch to the nth branch/worktree of the currently active workspace.
 * Index is 0-based (Cmd+1 → 0, Cmd+2 → 1, …).
 * Items are ordered: branches first (sidebar order), then worktrees.
 */
export function switchWorkspaceItemByIndex(
  index: number,
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  const ui = getUiState();
  if (!ui.activeContextId) return;

  const ws = getWorkspaceCollection().toArray.find(
    (w) =>
      ui.activeContextId === w.id ||
      ui.activeContextId.startsWith(`${w.id}-branch-`) ||
      ui.activeContextId.startsWith(`${w.id}-wt-`),
  );
  if (!ws) return;

  const items = [
    ...ws.branches.map((b) => `${ws.id}-branch-${b.name}`),
    ...ws.worktrees.map((wt) => `${ws.id}-wt-${wt.name}`),
  ];

  const itemId = items[index];
  if (itemId) selectWorkspaceItem(itemId, navigate);
}

export function toggleSidebar(): void {
  uiCollection.update('ui', (draft) => {
    draft.sidebarVisible = !draft.sidebarVisible;
  });
}

export function setSidebarWidth(width: number): void {
  uiCollection.update('ui', (draft) => {
    draft.sidebarWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width));
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
  newBranch?: string,
): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    const wt = await gitApi.createWorktree(ws.path, name, path, baseBranch, newBranch);
    // Add the new worktree to the sidebar
    getWorkspaceCollection().update(workspaceId, (draft) => {
      if (!draft.worktrees.some((w) => w.name === wt.name)) {
        draft.worktrees.push({ name: wt.name, path: wt.path, branch: wt.branch });
      }
    });
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

/** Remove worktree from sidebar only (can be re-opened from palette). Closes all associated tabs. */
export function hideWorktree(workspaceId: string, name: string): void {
  const wtItemId = `${workspaceId}-wt-${name}`;
  for (const tab of getTabCollection().toArray.filter((t) => t.workspaceItemId === wtItemId)) {
    closeTab(tab.id);
  }
  getWorkspaceCollection().update(workspaceId, (draft) => {
    draft.worktrees = draft.worktrees.filter((wt) => wt.name !== name);
  });
}

export function openWorktree(
  workspaceId: string,
  name: string,
  path: string,
  branch: string,
): void {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  // Don't add if already in the list
  if (ws.worktrees.some((wt) => wt.name === name)) return;
  getWorkspaceCollection().update(workspaceId, (draft) => {
    draft.worktrees.push({ name, path, branch });
  });
}

export function renameWorktree(workspaceId: string, wtName: string, label: string): void {
  getWorkspaceCollection().update(workspaceId, (draft) => {
    const wt = draft.worktrees.find((w) => w.name === wtName);
    if (wt) wt.label = label || undefined;
  });
}

export function reorderWorkspaces(orderedIds: string[]): void {
  const col = getWorkspaceCollection();
  for (let i = 0; i < orderedIds.length; i++) {
    col.update(orderedIds[i], (draft) => {
      draft.position = i;
    });
  }
}
