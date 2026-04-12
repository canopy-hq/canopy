import {
  getTabCollection,
  getProjectCollection,
  uiCollection,
  getUiState,
  getSetting,
  setSetting,
  getSettingCollection,
  insertTab,
  insertTabSilently,
  deleteTab,
  syncNavStateToLocalStorage,
} from '@canopy/db';
import {
  closePty,
  closePtysForPanes,
  disposeCached,
  initTerminalPool,
  spawnTerminal,
  writeToPty,
} from '@canopy/terminal';

import { router } from '../router';
import { pushNav } from './nav-history';
import {
  collectAllLeafPaneIds,
  collectLeafPtyIds,
  findLeaf,
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate as navFn,
  updateRatio as updateRatioFn,
  type PaneId,
  type SplitDirection,
} from './pane-tree-ops';

import type { Tab } from '@canopy/db';

/** Resolve a projectItemId composite key to a filesystem path. */
export function resolveProjectItemCwd(projectItemId: string): string | undefined {
  for (const proj of getProjectCollection().toArray) {
    if (projectItemId === proj.id) return proj.path;

    const branchPrefix = `${proj.id}-branch-`;
    if (projectItemId.startsWith(branchPrefix)) return proj.path;

    const wtPrefix = `${proj.id}-wt-`;
    if (projectItemId.startsWith(wtPrefix)) {
      const wtName = projectItemId.slice(wtPrefix.length);
      const wt = proj.worktrees.find((w) => w.name === wtName);
      return wt?.path ?? proj.path;
    }
  }
  return undefined;
}

function storePaneCwd(paneId: string, projectItemId: string): void {
  const cwd = resolveProjectItemCwd(projectItemId);
  if (cwd) setSetting(`cwd:${paneId}`, cwd);
}

function getNextTabIndex(projectItemId: string): number {
  const usedNumbers = new Set(
    getTabCollection()
      .toArray.filter((t) => t.projectItemId === projectItemId && !t.labelIsManual)
      .map((t) => {
        const match = /^Terminal (\d+)$/.exec(t.label);
        return match ? parseInt(match[1]!, 10) : null;
      })
      .filter((n): n is number => n !== null),
  );
  let i = 1;
  while (usedNumbers.has(i)) i++;
  return i;
}

function makeTab(opts?: { projectItemId?: string; label?: string }): Tab {
  const id = crypto.randomUUID();
  const paneId = crypto.randomUUID();
  const projectItemId = opts?.projectItemId ?? 'default';
  return {
    id,
    label: opts?.label ?? `Terminal ${getNextTabIndex(projectItemId)}`,
    labelIsManual: false,
    projectItemId,
    paneRoot: { type: 'leaf', id: paneId, ptyId: -1 },
    focusedPaneId: paneId,
    position: Math.max(-1, ...getTabCollection().toArray.map((t) => t.position)) + 1,
  };
}

export function renameTab(id: string, label: string, manual: boolean): void {
  const raw = label.trim();
  if (!raw) return;
  const trimmed = raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
  getTabCollection().update(id, (draft) => {
    draft.label = trimmed;
    draft.labelIsManual = manual;
  });
}

// Prevents spawning shells for every intermediate project during rapid switching —
// only the final destination gets a pool init, avoiding N×(shell startup CPU) spikes.
const POOL_INIT_DEBOUNCE_MS = 300;
let _poolInitTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePoolInit(contextId: string): void {
  const ui = getUiState();
  const cwd = resolveProjectItemCwd(contextId);
  const isInvalid = ui.invalidProjectIds.some(
    (id) => contextId === id || contextId.startsWith(`${id}-`),
  );
  if (cwd && !isInvalid) {
    if (_poolInitTimer !== null) clearTimeout(_poolInitTimer);
    _poolInitTimer = setTimeout(() => {
      _poolInitTimer = null;
      void initTerminalPool(cwd);
    }, POOL_INIT_DEBOUNCE_MS);
  }
}

/**
 * Sync the store from the active route's URL params.
 * Called by the tab child route's useEffect — this is the ONLY place that writes
 * activeTabId / activeContextId to the store.
 */
export function activateTabFromRoute(contextId: string, tabId: string): void {
  const ui = getUiState();
  schedulePoolInit(contextId);
  syncNavStateToLocalStorage(tabId, contextId);
  uiCollection.update('ui', (draft) => {
    // Save outgoing context's active tab before switching
    if (ui.activeContextId && ui.activeContextId !== contextId) {
      draft.contextActiveTabIds[ui.activeContextId] = ui.activeTabId;
    }
    draft.contextActiveTabIds[contextId] = tabId;
    draft.activeContextId = contextId;
    draft.activeTabId = tabId;
    draft.selectedItemId = contextId;
  });
}

export function addTab(projectItemId?: string): void {
  const ui = getUiState();
  const itemId = projectItemId ?? ui.activeContextId;
  if (!itemId) return;
  const tab = makeTab({ projectItemId: itemId });
  storePaneCwd(tab.paneRoot.id, itemId);
  insertTab(tab);
  syncNavStateToLocalStorage(tab.id, itemId, [...getTabCollection().toArray, tab]);
  void router.navigate({
    to: '/projects/$projectId/tabs/$tabId',
    params: { projectId: itemId, tabId: tab.id },
    replace: true,
  });
  pushTabNav(tab);
}

export const CLAUDE_DEFAULT_MODE_KEY = 'claudeDefaultMode';

export function getClaudeDefaultMode(): 'bypass' | 'plan' {
  return getSetting<'bypass' | 'plan'>(
    getSettingCollection().toArray,
    CLAUDE_DEFAULT_MODE_KEY,
    'bypass',
  );
}

export function addClaudeCodeTab(
  projectItemId?: string,
  options?: { mode?: 'bypass' | 'plan'; prompt?: string },
): void {
  const itemId = projectItemId ?? getUiState().activeContextId;
  if (!itemId) return;
  const base = makeTab({ projectItemId: itemId, label: 'Claude Code' });
  const tab = { ...base, labelIsManual: true, icon: 'claude-code' };
  storePaneCwd(tab.paneRoot.id, itemId);
  const mode = options?.mode ?? getClaudeDefaultMode();
  const permFlag = mode === 'plan' ? 'plan' : 'bypassPermissions';
  const baseCmd = `CLAUDE_CODE_NO_FLICKER=1 claude --permission-mode ${permFlag}`;
  // Pass the prompt as a CLI argument so Claude receives it at startup rather than
  // via a deferred writeToPty. Single-quote the value and escape any inner quotes.
  const cmd = options?.prompt ? `${baseCmd} '${options.prompt.replace(/'/g, "'\\''")}'` : baseCmd;
  setSetting(`init-cmd:${tab.paneRoot.id}`, cmd);
  // Store a flag so TerminalPane knows a prompt arg is embedded — avoids fragile regex on the cmd string.
  if (options?.prompt) setSetting(`init-has-prompt:${tab.paneRoot.id}`, 'true');
  // Only switch to the new tab if the user is currently on this worktree.
  if (getUiState().activeContextId === itemId) {
    insertTab(tab);
    syncNavStateToLocalStorage(tab.id, itemId, [...getTabCollection().toArray, tab]);
    void router.navigate({
      to: '/projects/$projectId/tabs/$tabId',
      params: { projectId: itemId, tabId: tab.id },
      replace: true,
    });
    pushTabNav(tab);
  } else {
    insertTabSilently(tab);
    // Spawn PTY in the background so Claude starts immediately without the user
    // having to navigate to the worktree first.
    const paneId = tab.paneRoot.id;
    const cwd = resolveProjectItemCwd(itemId);
    void (async () => {
      try {
        const { ptyId } = await spawnTerminal(paneId, cwd, 50, 220);
        setPtyIdInTab(tab.id, paneId, ptyId);
        await writeToPty(ptyId, cmd + '\r');
        setSetting(`init-cmd:${paneId}`, ''); // already sent — prevent TerminalPane re-sending
        setSetting(`init-has-prompt:${paneId}`, '');
      } catch {
        // Background spawn failed — terminal will spawn normally when user navigates there
      }
    })();
  }
}

export function closeTab(tabId: string): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;

  // Clean up all PTYs for this tab — both known (by ptyId) and orphan (by paneId).
  for (const ptyId of collectLeafPtyIds(tab.paneRoot)) {
    disposeCached(ptyId);
    void closePty(ptyId).catch(() => {});
  }
  void closePtysForPanes(collectAllLeafPaneIds(tab.paneRoot)).catch(() => {});

  const contextId = tab.projectItemId;
  const contextTabs = col.toArray.filter((t) => t.projectItemId === contextId);
  const ui = getUiState();

  if (contextTabs.length === 1) {
    deleteTab(tabId);
    uiCollection.update('ui', (draft) => {
      const { [contextId]: _, ...rest } = draft.contextActiveTabIds;
      draft.contextActiveTabIds = rest;
    });
    syncNavStateToLocalStorage('', contextId, []);
    void router.navigate({
      to: '/projects/$projectId',
      params: { projectId: contextId },
      replace: true,
    });
    return;
  }

  const sorted = contextTabs.sort((a, b) => a.position - b.position);
  const closedIndex = sorted.findIndex((t) => t.id === tabId);
  const remaining = sorted.filter((t) => t.id !== tabId);

  deleteTab(tabId);

  if (ui.activeTabId === tabId) {
    // Prefer the tab to the left; fall back to the right if closing the first.
    const newTab = remaining[Math.max(0, closedIndex - 1)]!;
    syncNavStateToLocalStorage(newTab.id, contextId, remaining);
    void router.navigate({
      to: '/projects/$projectId/tabs/$tabId',
      params: { projectId: contextId, tabId: newTab.id },
      replace: true,
    });
  }
}

function pushTabNav(tab: { id: string; label: string; projectItemId: string }): void {
  const contextId = tab.projectItemId;
  const proj = getProjectCollection().toArray.find(
    (p) =>
      contextId === p.id ||
      contextId.startsWith(`${p.id}-branch-`) ||
      contextId.startsWith(`${p.id}-wt-`),
  );
  pushNav({
    type: 'worktree',
    contextId,
    tabId: tab.id,
    label: tab.label,
    projectId: proj?.id,
    projectName: proj?.name,
    timestamp: Date.now(),
  });
}

export function switchTab(tabId: string): void {
  const tab = getTabCollection().toArray.find((t) => t.id === tabId);
  if (!tab) return;
  syncNavStateToLocalStorage(tabId, getUiState().activeContextId);
  void router.navigate({
    to: '/projects/$projectId/tabs/$tabId',
    params: { projectId: tab.projectItemId, tabId },
    replace: true,
  });
  pushTabNav(tab);
}

export function switchTabByIndex(index: number): void {
  const ui = getUiState();
  const contextTabs = getTabCollection().toArray.filter(
    (t) => t.projectItemId === ui.activeContextId,
  );
  if (index >= 0 && index < contextTabs.length) {
    const tab = contextTabs[index]!;
    syncNavStateToLocalStorage(tab.id, ui.activeContextId);
    void router.navigate({
      to: '/projects/$projectId/tabs/$tabId',
      params: { projectId: ui.activeContextId, tabId: tab.id },
      replace: true,
    });
    pushTabNav(tab);
  }
}

export function switchTabRelative(direction: 'prev' | 'next'): void {
  const ui = getUiState();
  const contextTabs = getTabCollection().toArray.filter(
    (t) => t.projectItemId === ui.activeContextId,
  );
  const idx = contextTabs.findIndex((t) => t.id === ui.activeTabId);
  if (idx === -1) return;
  const newIdx =
    direction === 'next'
      ? (idx + 1) % contextTabs.length
      : (idx - 1 + contextTabs.length) % contextTabs.length;
  const tab = contextTabs[newIdx]!;
  syncNavStateToLocalStorage(tab.id, ui.activeContextId);
  void router.navigate({
    to: '/projects/$projectId/tabs/$tabId',
    params: { projectId: ui.activeContextId, tabId: tab.id },
    replace: true,
  });
  pushTabNav(tab);
}

export function getActiveTab(): Tab | undefined {
  const ui = getUiState();
  return getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
}

export function getContextTabs(): Tab[] {
  const ui = getUiState();
  return getTabCollection().toArray.filter((t) => t.projectItemId === ui.activeContextId);
}

export function splitPane(paneId: PaneId, direction: SplitDirection, newPtyId: number): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  const [newTree, newLeafId] = splitNode(tab.paneRoot, paneId, direction, newPtyId);
  storePaneCwd(newLeafId, tab.projectItemId);
  getTabCollection().update(tab.id, (draft) => {
    draft.paneRoot = newTree;
    draft.focusedPaneId = newLeafId;
  });
}

/** Close a pane in a specific tab (not necessarily the active one). */
export function closePaneInTab(tabId: string, paneId: PaneId): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  const result = removeNode(tab.paneRoot, paneId);
  col.update(tab.id, (draft) => {
    if (result === null) {
      const newId = crypto.randomUUID();
      draft.paneRoot = { type: 'leaf', id: newId, ptyId: -1 };
      draft.focusedPaneId = newId;
    } else {
      draft.paneRoot = result;
      if (draft.focusedPaneId === paneId) {
        const firstLeaf = findFirstLeaf(result);
        draft.focusedPaneId = firstLeaf?.id ?? null;
      }
    }
  });
}

export function closePane(paneId: PaneId): void {
  const tab = getTabCollection().toArray.find((t) => t.id === getUiState().activeTabId);
  if (!tab) return;
  // Clean up PTY for this pane before removing it from the tree.
  const leaf = findLeaf(tab.paneRoot, paneId);
  if (leaf && leaf.ptyId > 0) {
    disposeCached(leaf.ptyId);
    void closePty(leaf.ptyId).catch(() => {});
  }
  void closePtysForPanes([paneId]).catch(() => {});
  closePaneInTab(tab.id, paneId);
}

/**
 * Mark a pane as killed (ptyId = -2). The pane stays in the tree but shows
 * a "session terminated" screen instead of spawning a new terminal.
 */
export function killPaneInTab(tabId: string, paneId: PaneId): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  col.update(tab.id, (draft) => {
    function markKilled(node: Tab['paneRoot']): void {
      if (node.type === 'leaf') {
        if (node.id === paneId) node.ptyId = -2;
        return;
      }
      for (const child of node.children) markKilled(child);
    }
    markKilled(draft.paneRoot);
  });
}

/**
 * Navigate to a specific project → tab → pane from anywhere in the app.
 *
 * - Same context: navigate to tab URL directly — router replace, no re-mount.
 * - Cross context: navigate to tab URL; activateTabFromRoute handles store sync.
 * - Pane: focusedPaneId is set directly on the tab, independent of active context.
 */
export function jumpToPane(
  navigate: (opts: { to: string; params?: Record<string, string> }) => void,
  projectItemId: string,
  tabId?: string,
  paneId?: string,
): void {
  if (tabId && paneId) {
    getTabCollection().update(tabId, (draft) => {
      draft.focusedPaneId = paneId;
    });
  }

  uiCollection.update('ui', (draft) => {
    draft.selectedItemId = projectItemId;
  });

  if (tabId) {
    navigate({
      to: '/projects/$projectId/tabs/$tabId',
      params: { projectId: projectItemId, tabId },
    });
  } else {
    navigate({ to: '/projects/$projectId', params: { projectId: projectItemId } });
  }
}

export function setFocus(paneId: PaneId): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  getTabCollection().update(tab.id, (draft) => {
    draft.focusedPaneId = paneId;
  });
}

export function navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab || !tab.focusedPaneId) return;
  const targetId = navFn(tab.paneRoot, tab.focusedPaneId, direction);
  if (targetId) {
    getTabCollection().update(tab.id, (draft) => {
      draft.focusedPaneId = targetId;
    });
  }
}

export function updateRatio(branchId: string, splitIndex: number, delta: number): void {
  const ui = getUiState();
  const tab = getTabCollection().toArray.find((t) => t.id === ui.activeTabId);
  if (!tab) return;
  const newRoot = updateRatioFn(tab.paneRoot, branchId, splitIndex, delta);
  getTabCollection().update(tab.id, (draft) => {
    draft.paneRoot = newRoot;
  });
}

/** Set ptyId in a specific tab (not necessarily the active one). Used for startup session restore. */
export function setPtyIdInTab(tabId: string, paneId: PaneId, ptyId: number): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  col.update(tab.id, (draft) => {
    function setInTree(node: Tab['paneRoot']): void {
      if (node.type === 'leaf') {
        if (node.id === paneId) node.ptyId = ptyId;
        return;
      }
      for (const child of node.children) setInTree(child);
    }
    setInTree(draft.paneRoot);
  });
}

export function setPtyId(paneId: PaneId, ptyId: number): void {
  const tab = getTabCollection().toArray.find((t) => t.id === getUiState().activeTabId);
  if (!tab) return;
  setPtyIdInTab(tab.id, paneId, ptyId);
}

export function closeAllTabs(contextId: string): void {
  const col = getTabCollection();
  const tabs = col.toArray.filter((t) => t.projectItemId === contextId);
  for (const tab of tabs) closeTab(tab.id);
}

export function closeAllTabsExcept(tabId: string): void {
  const col = getTabCollection();
  const tab = col.toArray.find((t) => t.id === tabId);
  if (!tab) return;
  const others = col.toArray.filter((t) => t.projectItemId === tab.projectItemId && t.id !== tabId);
  for (const other of others) closeTab(other.id);
}

export function reorderTabs(orderedIds: string[]): void {
  const col = getTabCollection();
  for (let i = 0; i < orderedIds.length; i++) {
    col.update(orderedIds[i], (draft) => {
      draft.position = i;
    });
  }
}
