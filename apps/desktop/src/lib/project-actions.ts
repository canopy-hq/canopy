import {
  getProjectCollection,
  getTabCollection,
  uiCollection,
  getUiState,
  getSetting,
  getSettingCollection,
  setSetting,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from '@superagent/db';
import { closePty, closePtysForPanes, disposeCached } from '@superagent/terminal';

import * as gitApi from './git';
import { collectAllLeafPaneIds, collectLeafPtyIds } from './pane-tree-ops';
import { addClaudeCodeTab, closeTab } from './tab-actions';
import { showErrorToast, showInfoToast } from './toast';

type NavigateFn = (opts: { to: string; params?: Record<string, string> }) => void;

import type { Project } from '@superagent/db';

/** Returns true for branch/worktree IDs — the only items that carry selection state. */
export function isSelectableProjectItem(id: string): boolean {
  return id.includes('-branch-') || id.includes('-wt-');
}

/** All sidebar item IDs for a project (repo root + branches + worktrees). */
export function getProjectItemIds(proj: Project): Set<string> {
  const ids = new Set<string>();
  ids.add(proj.id);
  for (const b of proj.branches) ids.add(`${proj.id}-branch-${b.name}`);
  for (const wt of proj.worktrees) ids.add(`${proj.id}-wt-${wt.name}`);
  return ids;
}

export async function openImportDialog(navigate?: NavigateFn): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Git Repository',
    });
    if (selected && typeof selected === 'string') await importRepo(selected, navigate);
  } catch {
    // Dialog not available in test/dev environments
  }
}

export async function importRepo(path: string, navigate?: NavigateFn): Promise<void> {
  try {
    const info = await gitApi.importRepo(path);
    const collection = getProjectCollection();

    const existing = collection.toArray.find((p) => p.path === info.path);
    if (existing) {
      showInfoToast(`"${existing.name}" is already imported`);
    } else {
      const projectId = crypto.randomUUID();
      collection.insert({
        id: projectId,
        path: info.path,
        name: info.name,
        branches: info.branches.filter((b) => b.is_head),
        worktrees: info.worktrees,
        expanded: true,
        position: collection.toArray.length,
      });

      if (navigate) {
        const headBranch = info.branches.find((b) => b.is_head);
        const itemId = headBranch ? `${projectId}-branch-${headBranch.name}` : projectId;
        selectProjectItem(itemId, navigate);
      }
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
  const proj = getProjectCollection().toArray.find((p) => p.id === id);
  if (!proj) return;

  const itemIds = getProjectItemIds(proj);

  const tabCol = getTabCollection();
  const tabs = tabCol.toArray.filter((t) => itemIds.has(t.projectItemId));

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

  getProjectCollection().delete(id);
}

export async function refreshRepo(id: string): Promise<void> {
  const proj = getProjectCollection().toArray.find((p) => p.id === id);
  if (!proj) return;
  try {
    const info = await gitApi.importRepo(proj.path);
    getProjectCollection().update(id, (draft) => {
      const headBranch = info.branches.find((b) => b.is_head);
      if (headBranch) {
        const existing = draft.branches.find((b) => b.name === headBranch.name);
        if (existing) {
          existing.is_head = true;
        } else {
          draft.branches = [headBranch];
        }
      }
      // Don't overwrite worktrees — import_repo returns [] now,
      // but we want to keep user-opened worktrees in the sidebar.
    });
  } catch (err) {
    showErrorToast('Refresh failed', String(err));
  }
}

export function toggleExpanded(id: string): void {
  getProjectCollection().update(id, (draft) => {
    draft.expanded = !draft.expanded;
  });
}

export function setProjectColor(id: string, color: string | null): void {
  getProjectCollection().update(id, (draft) => {
    draft.color = color;
  });
}

export function setSelectedItem(itemId: string | null): void {
  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = itemId;
  });
}

const RECENT_MAX = 10;

function trackRecentProject(itemId: string): void {
  // Extract project ID from composite item IDs (e.g. "proj-id-branch-main" → "proj-id")
  const proj = getProjectCollection().toArray.find(
    (p) =>
      itemId === p.id || itemId.startsWith(`${p.id}-branch-`) || itemId.startsWith(`${p.id}-wt-`),
  );
  if (!proj) return;

  const settings = getSettingCollection().toArray;
  const current = getSetting<string[]>(settings, 'recentProjectIds', []);
  const updated = [proj.id, ...current.filter((id) => id !== proj.id)].slice(0, RECENT_MAX);
  setSetting('recentProjectIds', updated);
}

export function selectProjectItem(
  itemId: string | null,
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = itemId;
  });
  if (itemId !== null) {
    trackRecentProject(itemId);
    navigate({ to: '/projects/$projectId', params: { projectId: itemId } });
  } else {
    navigate({ to: '/' });
  }
}

/**
 * Switch to the nth branch/worktree of the currently active project.
 * Index is 0-based (Cmd+1 → 0, Cmd+2 → 1, …).
 * Items are ordered: branches first (sidebar order), then worktrees.
 */
export function switchProjectItemByIndex(
  index: number,
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  const ui = getUiState();
  if (!ui.activeContextId) return;

  const proj = getProjectCollection().toArray.find(
    (p) =>
      ui.activeContextId === p.id ||
      ui.activeContextId.startsWith(`${p.id}-branch-`) ||
      ui.activeContextId.startsWith(`${p.id}-wt-`),
  );
  if (!proj) return;

  const items = [
    ...proj.branches.map((b) => `${proj.id}-branch-${b.name}`),
    ...proj.worktrees.map((wt) => `${proj.id}-wt-${wt.name}`),
  ];

  const itemId = items[index];
  if (itemId) selectProjectItem(itemId, navigate);
}

/** Navigate to the Nth project (sorted by position, 0-based). Max 9 shortcuts. */
export function switchProjectByIndex(
  index: number,
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  const projects = [...getProjectCollection().toArray].sort((a, b) => a.position - b.position);
  const proj = projects[index];
  if (!proj) return;

  // Navigate to the HEAD branch if available, otherwise the first branch, otherwise project root.
  const head = proj.branches.find((b) => b.is_head);
  const first = proj.branches[0];
  const itemId = head
    ? `${proj.id}-branch-${head.name}`
    : first
      ? `${proj.id}-branch-${first.name}`
      : proj.id;
  selectProjectItem(itemId, navigate);
}

/** Navigate to the previous or next branch/worktree within the active project. */
export function switchProjectItemRelative(
  direction: 'prev' | 'next',
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
): void {
  const ui = getUiState();
  if (!ui.activeContextId) return;

  const proj = getProjectCollection().toArray.find(
    (p) =>
      ui.activeContextId === p.id ||
      ui.activeContextId.startsWith(`${p.id}-branch-`) ||
      ui.activeContextId.startsWith(`${p.id}-wt-`),
  );
  if (!proj) return;

  const items = [
    ...proj.branches.map((b) => `${proj.id}-branch-${b.name}`),
    ...proj.worktrees.map((wt) => `${proj.id}-wt-${wt.name}`),
  ];
  if (items.length === 0) return;

  const currentIndex = items.indexOf(ui.activeContextId);
  const nextIndex =
    direction === 'next'
      ? (currentIndex + 1) % items.length
      : (currentIndex - 1 + items.length) % items.length;

  const itemId = items[nextIndex];
  if (itemId) selectProjectItem(itemId, navigate);
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

export async function createBranch(projectId: string, name: string, base: string): Promise<void> {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;
  try {
    await gitApi.createBranch(proj.path, name, base);
    await refreshRepo(projectId);
  } catch (err) {
    showErrorToast('Create branch failed', String(err));
  }
}

export async function deleteBranch(projectId: string, name: string): Promise<void> {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;
  try {
    await gitApi.deleteBranch(proj.path, name);
    await refreshRepo(projectId);
  } catch (err) {
    showErrorToast('Delete branch failed', String(err));
  }
}

export async function createWorktree(
  projectId: string,
  name: string,
  path: string,
  baseBranch?: string,
  newBranch?: string,
): Promise<void> {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;
  try {
    const wt = await gitApi.createWorktree(proj.path, name, path, baseBranch, newBranch);
    // Add the new worktree to the sidebar
    getProjectCollection().update(projectId, (draft) => {
      if (!draft.worktrees.some((w) => w.name === wt.name)) {
        draft.worktrees.push({ name: wt.name, path: wt.path, branch: wt.branch });
      }
    });
    await refreshRepo(projectId);
  } catch (err) {
    showErrorToast('Create worktree failed', String(err));
  }
}

/**
 * Optimistically adds the worktree to the sidebar, navigates to it, then runs the
 * git op in the background — showing a "creating" spinner until it completes.
 */
export function startWorktreeCreation(
  projectId: string,
  name: string,
  path: string,
  baseBranch: string | undefined,
  newBranch: string | undefined,
  navigate: NavigateFn,
): void {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;

  const wtItemId = `${projectId}-wt-${name}`;
  const estimatedBranch = newBranch ?? baseBranch ?? name;

  getProjectCollection().update(projectId, (draft) => {
    if (!draft.worktrees.some((w) => w.name === name)) {
      draft.worktrees.push({ name, path, branch: estimatedBranch });
    }
  });

  uiCollection.update('ui', (draft) => {
    if (!draft.creatingWorktreeIds.includes(wtItemId)) {
      draft.creatingWorktreeIds.push(wtItemId);
    }
    draft.justStartedWorktreeId = wtItemId;
  });

  selectProjectItem(wtItemId, navigate);

  void (async () => {
    try {
      const wt = await gitApi.createWorktree(proj.path, name, path, baseBranch, newBranch);
      getProjectCollection().update(projectId, (draft) => {
        const entry = draft.worktrees.find((w) => w.name === name);
        if (entry) {
          entry.path = wt.path;
          entry.branch = wt.branch;
        }
      });
      // Clear creating state before addClaudeCodeTab — that function creates a
      // TanStack DB transaction that snapshots uiCollection. If we clear here first,
      // the snapshot captures creatingWorktreeIds:[] and acceptMutations() won't
      // restore the stale "creating" state when the async commit resolves.
      uiCollection.update('ui', (draft) => {
        draft.creatingWorktreeIds = draft.creatingWorktreeIds.filter((id) => id !== wtItemId);
      });

      // If the user scheduled a Claude Code session for this worktree, launch it now
      const pending = getUiState().pendingClaudeSession;
      if (pending?.worktreeId === wtItemId) {
        addClaudeCodeTab(wtItemId, { mode: pending.mode, prompt: pending.prompt });
        uiCollection.update('ui', (draft) => {
          draft.pendingClaudeSession = null;
        });
      }
    } catch (err) {
      showErrorToast('Create worktree failed', String(err));
      getProjectCollection().update(projectId, (draft) => {
        draft.worktrees = draft.worktrees.filter((w) => w.name !== name);
      });
      uiCollection.update('ui', (draft) => {
        draft.pendingClaudeSession = null;
      });
    } finally {
      uiCollection.update('ui', (draft) => {
        draft.creatingWorktreeIds = draft.creatingWorktreeIds.filter((id) => id !== wtItemId);
      });
    }
  })();
}

export function clearJustStartedWorktree(): void {
  uiCollection.update('ui', (draft) => {
    draft.justStartedWorktreeId = null;
  });
}

export function setPendingClaudeSession(
  worktreeId: string,
  mode: 'bypass' | 'plan',
  prompt?: string,
): void {
  // If the worktree finished creating before the user confirmed the dialog,
  // launch Claude immediately — the async completion handler already ran and
  // found no pending session, so we have to trigger it ourselves here.
  if (!getUiState().creatingWorktreeIds.includes(worktreeId)) {
    addClaudeCodeTab(worktreeId, { mode, prompt });
    return;
  }
  uiCollection.update('ui', (draft) => {
    draft.pendingClaudeSession = { worktreeId, mode, prompt };
  });
}

export function cancelPendingClaudeSession(): void {
  uiCollection.update('ui', (draft) => {
    draft.pendingClaudeSession = null;
  });
}

export async function removeWorktree(projectId: string, name: string): Promise<void> {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;
  try {
    await gitApi.removeWorktree(proj.path, name);
    await refreshRepo(projectId);
  } catch (err) {
    showErrorToast('Remove worktree failed', String(err));
  }
}

/** Remove worktree from sidebar only (can be re-opened from palette). Closes all associated tabs. */
export function hideWorktree(projectId: string, name: string): void {
  const wtItemId = `${projectId}-wt-${name}`;
  for (const tab of getTabCollection().toArray.filter((t) => t.projectItemId === wtItemId)) {
    closeTab(tab.id);
  }
  getProjectCollection().update(projectId, (draft) => {
    draft.worktrees = draft.worktrees.filter((wt) => wt.name !== name);
  });
}

export function openWorktree(projectId: string, name: string, path: string, branch: string): void {
  const proj = getProjectCollection().toArray.find((p) => p.id === projectId);
  if (!proj) return;
  // Don't add if already in the list
  if (proj.worktrees.some((wt) => wt.name === name)) return;
  getProjectCollection().update(projectId, (draft) => {
    draft.worktrees.push({ name, path, branch });
  });
}

export function renameWorktree(projectId: string, wtName: string, label: string): void {
  getProjectCollection().update(projectId, (draft) => {
    const wt = draft.worktrees.find((w) => w.name === wtName);
    if (wt) wt.label = label || undefined;
  });
}

export function renameProject(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getProjectCollection().update(id, (draft) => {
    draft.name = trimmed;
  });
}

export function reorderProjects(orderedIds: string[]): void {
  const col = getProjectCollection();
  for (let i = 0; i < orderedIds.length; i++) {
    col.update(orderedIds[i], (draft) => {
      draft.position = i;
    });
  }
}
