import { useEffect, useRef, useMemo, useState, useCallback } from 'react';

import { CommandMenu } from '@canopy/command-palette';
import {
  agentCollection,
  getUiState,
  uiCollection,
  getTabCollection,
  getProjectCollection,
  getSettingCollection,
  getSetting,
  setSetting,
  getSessionCollection,
} from '@canopy/db';
import { FpsOverlay } from '@canopy/fps';
import { ensureGhosttyInit, spawnTerminal, initTerminalPool } from '@canopy/terminal';
import { createRootRoute, Outlet, useNavigate, useSearch } from '@tanstack/react-router';
import { LucideProvider } from 'lucide-react';

import { useAllCommands } from '../commands';
import { makeProjectPaletteItem } from '../commands/project-commands';
import { resolveProject } from '../commands/utils';
import { AddProjectDialog } from '../components/AddProjectDialog';
import { AgentOverlay } from '../components/AgentOverlay';
import { AgentToastRegion } from '../components/AgentToastRegion';
import { Header } from '../components/Header';
import { ErrorToastRegion } from '../components/ToastProvider';
import { useUiState } from '../hooks/useCollections';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { useTauriMenuEvent } from '../hooks/useTauriMenuEvent';
import { onOpenAddProjectDialog } from '../lib/add-project-bridge';
import { initAgentListener } from '../lib/agent-actions';
import { checkProjectPaths, listWorktrees } from '../lib/git';
import { getConnection, GITHUB_CONNECTION_KEY } from '../lib/github';
import { logInfo } from '../lib/log';
import { pushNav, deriveContextLabel } from '../lib/nav-history';
import { collectRestorablePaneIds, containsPtyId } from '../lib/pane-tree-ops';
import {
  toggleSidebar,
  refreshRepo,
  hideWorktree,
  switchProjectRelative,
  switchProjectItemRelative,
  openAddProjectDialog,
  goBack,
  goForward,
  navigateToSettings,
} from '../lib/project-actions';
import { onOpenProjectPalette, openProjectPalette } from '../lib/project-palette-bridge';
import { getActiveTab, setPtyIdInTab, getContextIdFromUrl } from '../lib/tab-actions';
import { showAgentToastDeduped } from '../lib/toast';
import { router } from '../router';

import type { CommandItem } from '@canopy/command-palette';

// Pre-initialize ghostty-web WASM at module load.
void ensureGhosttyInit();

// Preload Geist Mono so the terminal font gate in useTerminal resolves immediately
// on first mount — without this, Ghostty renders with a fallback font until the
// font is fetched. Matches the exact font string used in useTerminal's Terminal config.
void document.fonts?.load('13px "Geist Mono", Menlo, Monaco, "Courier New", monospace');
void document.fonts?.load('bold 13px "Geist Mono", Menlo, Monaco, "Courier New", monospace');

/**
 * Update search params without changing the current path.
 * TanStack Router's navigate() can't infer the search schema for search-only navigation
 * (no `from`/`to`), so we escape the type here rather than at every call site.
 */
function updateSearch(updater: (prev: Record<string, unknown>) => Record<string, unknown>): void {
  void router.navigate({ search: updater as never });
}

function RootLayout() {
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false);
  const [defaultPanelItem, setDefaultPanelItem] = useState<CommandItem | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [fpsVisible, setFpsVisible] = useState(false);
  const [recentlyViewedOpen, setRecentlyViewedOpen] = useState(false);
  const { panel, overlay } = useSearch({ strict: false }) as {
    panel?: 'sessions';
    overlay?: 'agents';
  };
  const sessionsOpen = panel === 'sessions';
  const overlayOpen = overlay === 'agents';
  const cmdItems = useAllCommands();
  const { activeContextId } = useUiState();
  const navigate = useNavigate();
  const booted = useRef(false);

  // Boot: restore last active workspace from DB (routing is source of truth after this)
  // Also refresh all workspaces so branches reflect current HEAD (cleans stale data).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const { activeContextId, activeTabId } = getUiState();
    const projects = getProjectCollection().toArray;
    if (activeContextId && projects.some((p) => activeContextId.startsWith(p.id))) {
      const tabs = getTabCollection().toArray;
      const activeTab = activeTabId
        ? tabs.find((t) => t.id === activeTabId && t.projectItemId === activeContextId)
        : null;
      if (activeTab) {
        void navigate({
          to: '/projects/$projectId/tabs/$tabId',
          params: { projectId: activeContextId, tabId: activeTab.id },
          state: { skipNav: true },
        });
      } else {
        void navigate({
          to: '/projects/$projectId',
          params: { projectId: activeContextId },
          state: { skipNav: true },
        });
      }
    }
    for (const ws of projects) {
      void refreshRepo(ws.id);
    }

    // Projects with no branches are incomplete clones (app was closed mid-clone).
    // Mark them invalid immediately so the user can remove them.
    const collection = getProjectCollection();
    for (const p of projects) {
      if (p.branches.length === 0 && !p.invalid) {
        collection.update(p.id, (draft) => {
          draft.invalid = true;
        });
      }
    }

    // Restore persisted invalid state immediately (no poll round-trip needed).
    const persistedInvalid = collection.toArray.filter((p) => p.invalid).map((p) => p.id);
    if (persistedInvalid.length > 0) {
      uiCollection.update('ui', (draft) => {
        draft.invalidProjectIds = persistedInvalid;
      });
    }

    // Run a fresh Rust path check — update DB + UiState if anything changed.
    const allPaths = projects.map((p) => p.path);
    if (allPaths.length > 0) {
      void checkProjectPaths(allPaths).then((invalidPaths) => {
        const invalidPathSet = new Set(invalidPaths);
        let changed = false;
        for (const p of collection.toArray) {
          const shouldBeInvalid = invalidPathSet.has(p.path);
          if (p.invalid !== shouldBeInvalid) {
            collection.update(p.id, (draft) => {
              draft.invalid = shouldBeInvalid;
            });
            changed = true;
          }
        }
        if (changed) {
          const nowInvalid = collection.toArray.filter((p) => p.invalid).map((p) => p.id);
          uiCollection.update('ui', (draft) => {
            draft.invalidProjectIds = nowInvalid;
          });
        }
      });
    }

    // Validate worktrees at boot — prune entries that no longer exist on disk.
    // Async IPC: never blocks UI rendering.
    void (async () => {
      let pruned = 0;
      for (const ws of getProjectCollection().toArray) {
        if (ws.worktrees.length === 0) continue;
        try {
          const live = await listWorktrees(ws.path);
          const liveNames = new Set(live.map((w) => w.name));
          for (const wt of ws.worktrees) {
            if (!liveNames.has(wt.name)) {
              logInfo(`[boot] pruning stale worktree "${wt.name}" from project "${ws.name}"`);
              hideWorktree(ws.id, wt.name);
              pruned++;
            }
          }
        } catch {
          // Repo moved or git unavailable — skip validation
        }
      }
      if (pruned > 0) {
        logInfo(`[boot] removed ${pruned} stale worktree(s)`);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Startup session restore: eagerly reconnect all panes across all tabs so they
  // appear in the Session Manager and the IPC output channels are ready before the
  // user navigates to each tab. Uses tabs (always complete) as source of truth,
  // not the sessions table (which only covers visited tabs).
  useEffect(() => {
    const tabs = getTabCollection().toArray;
    const settings = getSettingCollection().toArray;

    // Pre-warm the PTY pool even when there are no tabs to restore (fresh DB).
    // Use a saved pane CWD, or fall back to the first project's path.
    const invalidPathSet = new Set(
      getProjectCollection()
        .toArray.filter((p) => p.invalid)
        .map((p) => p.path),
    );
    const paneEntries = tabs.flatMap((tab) =>
      collectRestorablePaneIds(tab.paneRoot).map((paneId) => ({ tab, paneId })),
    );
    const firstCwd =
      paneEntries
        .map(({ paneId }) => (getSetting(settings, `cwd:${paneId}`, '') as string) || '')
        .find((cwd) => cwd.length > 0 && !invalidPathSet.has(cwd)) ||
      getProjectCollection().toArray.find((p) => !p.invalid)?.path;
    if (firstCwd) {
      void initTerminalPool(firstCwd);
    }

    if (tabs.length === 0) return;

    void Promise.all(
      paneEntries.map(async ({ tab, paneId }) => {
        const cwd = (getSetting(settings, `cwd:${paneId}`, '') as string) || undefined;
        try {
          const { ptyId } = await spawnTerminal(paneId, cwd, 24, 80);
          setPtyIdInTab(tab.id, paneId, ptyId);
          // Write session to DB — onPtySpawned never fires for the reconnect path
          const col = getSessionCollection();
          const existing = col.toArray.find((s) => s.paneId === paneId);
          if (existing) {
            col.update(existing.id, (draft) => {
              draft.tabId = tab.id;
              draft.projectId = tab.projectItemId;
              draft.cwd = cwd ?? '';
            });
          } else {
            col.insert({
              id: paneId,
              paneId,
              tabId: tab.id,
              projectId: tab.projectItemId,
              cwd: cwd ?? '',
              shell: '',
            });
          }
        } catch {
          // Daemon unavailable — pane stays at ptyId -1, fresh shell on visit
        }
      }),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useTauriMenuEvent('menu:settings', () => {
    navigateToSettings('appearance', navigate);
  });
  useTauriMenuEvent('menu:fps-overlay', () => setFpsVisible((prev) => !prev), import.meta.env.DEV);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void initAgentListener().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      if (toLocation.state.skipNav) return;
      const { pathname } = toLocation;
      if (pathname.startsWith('/settings')) {
        const section = (toLocation.search as Record<string, string>).section ?? 'appearance';
        pushNav({ type: 'settings', label: 'Settings', section, timestamp: Date.now() });
        return;
      }
      const projectMatch = /\/projects\/([^/]+)/.exec(pathname);
      if (!projectMatch) return;
      const contextId = decodeURIComponent(projectMatch[1]!);
      const tabMatch = /\/tabs\/([^/]+)/.exec(pathname);
      const tabId = tabMatch ? decodeURIComponent(tabMatch[1]!) : undefined;
      const proj = resolveProject(contextId, getProjectCollection().toArray);
      if (!proj) return;
      const tab = tabId ? getTabCollection().toArray.find((t) => t.id === tabId) : undefined;
      const label = tab?.label ?? deriveContextLabel(contextId, proj);
      pushNav(
        {
          type: 'worktree',
          projectId: proj.id,
          contextId,
          tabId,
          label,
          projectName: proj.name,
          timestamp: Date.now(),
        },
        contextId,
      );
    });
  }, []);

  useEffect(() => {
    const sub = agentCollection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === 'delete') continue;
        const agent = change.value;
        const tabs = getTabCollection().toArray;
        const activeTabId = getActiveTab()?.id;
        const agentTab = tabs.find((t) => containsPtyId(t.paneRoot, agent.ptyId));
        if (!agentTab || agentTab.id === activeTabId) continue;
        const projects = getProjectCollection().toArray;
        const ws = projects.find((p) => agentTab.projectItemId.startsWith(p.id));
        if (agent.status === 'waiting') {
          showAgentToastDeduped({
            type: 'agent-waiting',
            agentName: agent.agentName,
            project: ws?.name ?? 'Unknown',
            branch: agentTab.label,
            ptyId: agent.ptyId,
          });
        }
      }
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const settings = getSettingCollection().toArray;
    const theme = getSetting(settings, 'theme', 'obsidian') as string;
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    return onOpenProjectPalette((item) => {
      setDefaultPanelItem(item);
      setCmdMenuOpen(true);
    });
  }, []);

  useEffect(() => {
    return onOpenAddProjectDialog(() => setAddProjectOpen(true));
  }, []);

  // Hydrate GitHub connection status into settings for the header icon
  useEffect(() => {
    void getConnection().then((conn) => setSetting(GITHUB_CONNECTION_KEY, conn));
  }, []);

  const handleCmdMenuClose = useCallback(() => {
    setCmdMenuOpen(false);
    setDefaultPanelItem(null);
  }, []);

  const bindings: Keybinding[] = useMemo(
    () => [
      {
        key: 'k',
        meta: true,
        action: () =>
          setCmdMenuOpen((prev) => {
            if (prev) setDefaultPanelItem(null);
            return !prev;
          }),
      },
      { key: 'b', meta: true, action: () => toggleSidebar() },
      { key: 'N', meta: true, shift: true, action: () => openAddProjectDialog() },
      {
        key: 'n',
        meta: true,
        action: () => {
          const contextId = getContextIdFromUrl() ?? getUiState().activeContextId;
          if (!contextId) return;
          const proj = resolveProject(contextId, getProjectCollection().toArray);
          if (!proj || proj.invalid) return;
          openProjectPalette(makeProjectPaletteItem(proj));
        },
      },
      {
        key: 'O',
        meta: true,
        shift: true,
        action: () =>
          updateSearch((prev) => ({
            ...prev,
            overlay: prev.overlay === 'agents' ? undefined : 'agents',
          })),
      },
      // ⌘⇧H: recently viewed dropdown
      { key: 'H', meta: true, shift: true, action: () => setRecentlyViewedOpen((prev) => !prev) },
      // ⌘[ / ⌘]: back/forward navigation
      { key: '[', meta: true, action: () => goBack(navigate) },
      { key: ']', meta: true, action: () => goForward(navigate) },
      // ⌘⇧↑ / ⌘⇧↓: navigate to the prev/next project (sorted by position, wraps).
      {
        key: 'ArrowUp',
        meta: true,
        shift: true,
        action: () => switchProjectRelative('prev', navigate),
      },
      {
        key: 'ArrowDown',
        meta: true,
        shift: true,
        action: () => switchProjectRelative('next', navigate),
      },
      // ⌘↑ / ⌘↓: navigate to the prev/next branch or worktree within the active project.
      { key: 'ArrowUp', meta: true, action: () => switchProjectItemRelative('prev', navigate) },
      { key: 'ArrowDown', meta: true, action: () => switchProjectItemRelative('next', navigate) },
    ],
    [navigate],
  );

  useKeyboardRegistry(bindings);

  return (
    <LucideProvider strokeWidth={1}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-base">
        <Header
          onSearchClick={() => setCmdMenuOpen(true)}
          sessionsOpen={sessionsOpen}
          onSessionsOpenChange={(open) =>
            updateSearch((prev) => ({ ...prev, panel: open ? 'sessions' : undefined }))
          }
          recentlyViewedOpen={recentlyViewedOpen}
          onRecentlyViewedChange={setRecentlyViewedOpen}
        />
        <Outlet />
        <ErrorToastRegion />
        <CommandMenu
          isOpen={cmdMenuOpen}
          onClose={handleCmdMenuClose}
          items={cmdItems}
          activeContextId={activeContextId}
          defaultPanelItem={defaultPanelItem}
        />
        <AgentOverlay
          isOpen={overlayOpen}
          onClose={() => updateSearch((prev) => ({ ...prev, overlay: undefined }))}
        />
        {addProjectOpen && <AddProjectDialog onClose={() => setAddProjectOpen(false)} />}
        <AgentToastRegion />
        {import.meta.env.DEV && <FpsOverlay visible={fpsVisible} />}
      </div>
    </LucideProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  validateSearch: (s: Record<string, unknown>): { panel?: 'sessions'; overlay?: 'agents' } => ({
    panel: s.panel === 'sessions' ? 'sessions' : undefined,
    overlay: s.overlay === 'agents' ? 'agents' : undefined,
  }),
});
