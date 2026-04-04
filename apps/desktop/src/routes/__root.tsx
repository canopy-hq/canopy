import { useEffect, useRef, useMemo, useState } from 'react';

import {
  agentCollection,
  getUiState,
  getTabCollection,
  getWorkspaceCollection,
  getSettingCollection,
  getSetting,
  getSessionCollection,
} from '@superagent/db';
import { FpsOverlay } from '@superagent/fps';
import { ensureGhosttyInit, spawnTerminal } from '@superagent/terminal';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';

import { AgentOverlay } from '../components/AgentOverlay';
import { AgentToastRegion } from '../components/AgentToastRegion';
import { Header } from '../components/Header';
import { SessionManager } from '../components/SessionManager';
import { ErrorToastRegion } from '../components/ToastProvider';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { useTauriMenuEvent } from '../hooks/useTauriMenuEvent';
import { initAgentListener } from '../lib/agent-actions';
import { collectRestorablePaneIds, containsPtyId } from '../lib/pane-tree-ops';
import { getActiveTab, setPtyIdInTab } from '../lib/tab-actions';
import { showAgentToastDeduped } from '../lib/toast';
import { toggleSidebar, refreshRepo } from '../lib/workspace-actions';

// Pre-initialize ghostty-web WASM at module load so it's ready before the user
// opens their first terminal — eliminates the empty-container frame on first use.
void ensureGhosttyInit();

function RootLayout() {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [fpsVisible, setFpsVisible] = useState(false);
  const navigate = useNavigate();
  const booted = useRef(false);

  // Boot: restore last active workspace from DB (routing is source of truth after this)
  // Also refresh all workspaces so branches reflect current HEAD (cleans stale data).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const { activeContextId } = getUiState();
    if (activeContextId) {
      void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: activeContextId } });
    }
    for (const ws of getWorkspaceCollection().toArray) {
      void refreshRepo(ws.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Startup session restore: eagerly reconnect all panes across all tabs so they
  // appear in the Session Manager and the IPC output channels are ready before the
  // user navigates to each tab. Uses tabs (always complete) as source of truth,
  // not the sessions table (which only covers visited tabs).
  useEffect(() => {
    const tabs = getTabCollection().toArray;
    if (tabs.length === 0) return;
    const settings = getSettingCollection().toArray;
    const paneEntries = tabs.flatMap((tab) =>
      collectRestorablePaneIds(tab.paneRoot).map((paneId) => ({ tab, paneId })),
    );
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
              draft.workspaceId = tab.workspaceItemId;
              draft.cwd = cwd ?? '';
            });
          } else {
            col.insert({
              id: paneId,
              paneId,
              tabId: tab.id,
              workspaceId: tab.workspaceItemId,
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

  useTauriMenuEvent('menu:settings', () => void navigate({ to: '/settings' }));
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
    const sub = agentCollection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === 'delete') continue;
        const agent = change.value;
        const tabs = getTabCollection().toArray;
        const activeTabId = getActiveTab()?.id;
        const agentTab = tabs.find((t) => containsPtyId(t.paneRoot, agent.ptyId));
        if (!agentTab || agentTab.id === activeTabId) continue;
        const workspaces = getWorkspaceCollection().toArray;
        const ws = workspaces.find((w) => agentTab.workspaceItemId.startsWith(w.id));
        if (agent.status === 'waiting') {
          showAgentToastDeduped({
            type: 'agent-waiting',
            agentName: agent.agentName,
            workspace: ws?.name ?? 'Unknown',
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

  const bindings: Keybinding[] = useMemo(
    () => [
      { key: 'b', meta: true, action: () => toggleSidebar() },
      { key: 'o', meta: true, shift: true, action: () => setOverlayOpen((prev) => !prev) },
    ],
    [],
  );

  useKeyboardRegistry(bindings);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary">
      <Header onSessionsClick={() => setSessionManagerOpen((prev) => !prev)} />
      <Outlet />
      <ErrorToastRegion />
      <AgentOverlay isOpen={overlayOpen} onClose={() => setOverlayOpen(false)} />
      {sessionManagerOpen && <SessionManager onClose={() => setSessionManagerOpen(false)} />}
      <AgentToastRegion />
      {import.meta.env.DEV && <FpsOverlay visible={fpsVisible} />}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
