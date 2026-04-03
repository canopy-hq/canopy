import { useEffect, useRef, useMemo, useState } from 'react';

import {
  agentCollection,
  getUiState,
  getTabCollection,
  getWorkspaceCollection,
  getSettingCollection,
  getSetting,
} from '@superagent/db';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';

import { AgentOverlay } from '../components/AgentOverlay';
import { Header } from '../components/Header';
import { SessionManager } from '../components/SessionManager';
import { AgentToastRegion } from '../components/AgentToastRegion';
import { ErrorToastRegion } from '../components/ToastProvider';
import { useKeyboardRegistry, type Keybinding } from '../hooks/useKeyboardRegistry';
import { initAgentListener } from '../lib/agent-actions';
import { getActiveTab } from '../lib/tab-actions';
import { showAgentToastDeduped } from '../lib/toast';
import { toggleSidebar } from '../lib/workspace-actions';

import type { PaneNode } from '../lib/pane-tree-ops';

function containsPtyId(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((child) => containsPtyId(child, ptyId));
}

function RootLayout() {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const navigate = useNavigate();
  const booted = useRef(false);

  // Boot: restore last active workspace from DB (routing is source of truth after this)
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const { activeContextId } = getUiState();
    if (activeContextId) {
      void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: activeContextId } });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      void listen('menu:settings', () => {
        void navigate({ to: '/settings' });
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, [navigate]);

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
      <SessionManager isOpen={sessionManagerOpen} onClose={() => setSessionManagerOpen(false)} />
      <AgentToastRegion />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
