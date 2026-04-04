import { useEffect, useRef, useMemo, useState } from 'react';

import { CommandMenu } from '@superagent/command-palette';
import {
  agentCollection,
  getUiState,
  getTabCollection,
  getWorkspaceCollection,
  getSettingCollection,
  getSetting,
} from '@superagent/db';
import { FpsOverlay } from '@superagent/fps';
import { ensureGhosttyInit } from '@superagent/terminal';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';

import { useAllCommands } from '../commands';
import { AgentOverlay } from '../components/AgentOverlay';
import { AgentToastRegion } from '../components/AgentToastRegion';
import { Header } from '../components/Header';
import { SessionManager } from '../components/SessionManager';
import { ErrorToastRegion } from '../components/ToastProvider';
import { useUiState } from '../hooks/useCollections';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { useTauriMenuEvent } from '../hooks/useTauriMenuEvent';
import { initAgentListener } from '../lib/agent-actions';
import { containsPtyId, resetLeafPtyIds } from '../lib/pane-tree-ops';
import { getActiveTab } from '../lib/tab-actions';
import { showAgentToastDeduped } from '../lib/toast';
import { toggleSidebar, refreshRepo, switchWorkspaceItemByIndex } from '../lib/workspace-actions';

// Pre-initialize ghostty-web WASM at module load so it's ready before the user
// opens their first terminal — eliminates the empty-container frame on first use.
void ensureGhosttyInit();

function RootLayout() {
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [fpsVisible, setFpsVisible] = useState(false);
  const cmdItems = useAllCommands();
  const { activeContextId } = useUiState();
  const navigate = useNavigate();
  const booted = useRef(false);

  // Boot: restore last active workspace, refresh branches, and reset stale PTY IDs.
  // PTY process IDs don't survive restart — resetting them forces each terminal pane
  // to spawn at correct container dimensions on mount (avoids 24×80 SIGWINCH).
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
    const tabCol = getTabCollection();
    for (const tab of tabCol.toArray) {
      tabCol.update(tab.id, (draft) => {
        resetLeafPtyIds(draft.paneRoot);
      });
    }
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
      { key: 'k', meta: true, action: () => setCmdMenuOpen((prev) => !prev) },
      { key: 'b', meta: true, action: () => toggleSidebar() },
      { key: 'o', meta: true, shift: true, action: () => setOverlayOpen((prev) => !prev) },
      ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
        key: String(n),
        meta: true,
        action: () => switchWorkspaceItemByIndex(n - 1, navigate),
      })),
    ],
    [navigate],
  );

  useKeyboardRegistry(bindings);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary">
      <Header onSessionsClick={() => setSessionManagerOpen((prev) => !prev)} />
      <Outlet />
      <ErrorToastRegion />
      <CommandMenu
        isOpen={cmdMenuOpen}
        onClose={() => setCmdMenuOpen(false)}
        items={cmdItems}
        activeContextId={activeContextId}
      />
      <AgentOverlay isOpen={overlayOpen} onClose={() => setOverlayOpen(false)} />
      {sessionManagerOpen && <SessionManager onClose={() => setSessionManagerOpen(false)} />}
      <AgentToastRegion />
      {import.meta.env.DEV && <FpsOverlay visible={fpsVisible} />}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
