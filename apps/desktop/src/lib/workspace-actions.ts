import {
  getWorkspaceCollection,
  getTabCollection,
  uiCollection,
  getUiState,
  setSetting,
} from "@superagent/db";

import * as gitApi from "./git";
import { collectLeafPtyIds } from "./pane-tree-ops";
import { closePty } from "./pty";
import { setActiveContext } from "./tab-actions";
import { disposeCached } from "./terminal-cache";
import { showErrorToast } from "./toast";

import type { Workspace } from "@superagent/db";

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
    collection.insert({
      id: crypto.randomUUID(),
      path: info.path,
      name: info.name,
      branches: info.branches,
      worktrees: info.worktrees,
      expanded: true,
      position: collection.toArray.length,
    });
    uiCollection.update("ui", (draft) => {
      draft.sidebarVisible = true;
    });
    setSetting("sidebarVisible", true);
  } catch (err) {
    showErrorToast("Import failed", String(err));
  }
}

export async function closeProject(id: string): Promise<void> {
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

  for (const tab of tabs) {
    tabCol.delete(tab.id);
  }

  const ui = getUiState();
  if (itemIds.has(ui.activeContextId)) {
    uiCollection.update("ui", (draft) => {
      draft.activeContextId = "";
      draft.activeTabId = "";
      draft.selectedItemId = null;
    });
    setSetting("activeContextId", "");
    setSetting("activeTabId", "");
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
      draft.worktrees = info.worktrees;
    });
  } catch (err) {
    showErrorToast("Refresh failed", String(err));
  }
}

export function toggleExpanded(id: string): void {
  getWorkspaceCollection().update(id, (draft) => {
    draft.expanded = !draft.expanded;
  });
}

export function setSelectedItem(itemId: string | null): void {
  uiCollection.update("ui", (draft) => {
    draft.selectedItemId = itemId;
  });
}

export function selectWorkspaceItem(itemId: string | null, itemLabel?: string): void {
  uiCollection.update("ui", (draft) => {
    draft.selectedItemId = itemId;
  });
  if (itemId !== null && itemLabel) {
    setActiveContext(itemId);
  } else if (itemId === null) {
    setActiveContext("");
  }
}

export function toggleSidebar(): void {
  const newVisible = !getUiState().sidebarVisible;
  uiCollection.update("ui", (draft) => {
    draft.sidebarVisible = newVisible;
  });
  setSetting("sidebarVisible", newVisible);
}

export function setSidebarWidth(width: number): void {
  uiCollection.update("ui", (draft) => {
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
    showErrorToast("Create branch failed", String(err));
  }
}

export async function deleteBranch(workspaceId: string, name: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.deleteBranch(ws.path, name);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast("Delete branch failed", String(err));
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
    showErrorToast("Create worktree failed", String(err));
  }
}

export async function removeWorktree(workspaceId: string, name: string): Promise<void> {
  const ws = getWorkspaceCollection().toArray.find((w) => w.id === workspaceId);
  if (!ws) return;
  try {
    await gitApi.removeWorktree(ws.path, name);
    await refreshRepo(workspaceId);
  } catch (err) {
    showErrorToast("Remove worktree failed", String(err));
  }
}
