import { agentCollection, getTabCollection, type AgentStatus } from '@canopy/db';

import { containsPtyId } from './pane-tree-ops';
import { getActiveTab } from './tab-actions';

interface AgentStatusEvent {
  ptyId: number;
  status: string;
  agentName: string;
  pid: number;
  subState?: string;
}

const VALID_STATUSES = new Set(['working', 'permission', 'review', 'stopped', 'idle']);

/** Map backend status strings to a canonical value.
 * `idle` and `stopped` trigger removal — handled in initAgentListener. */
function normalizeStatus(status: string): AgentStatus | 'stopped' {
  return VALID_STATUSES.has(status) ? (status as AgentStatus | 'stopped') : 'idle';
}

/** Check if a pty_id belongs to the currently active tab. */
function isPtyInActiveTab(ptyId: number): boolean {
  const activeTab = getActiveTab();
  if (!activeTab) return false;
  return containsPtyId(activeTab.paneRoot, ptyId);
}

export function setAgent(
  ptyId: number,
  info: { status: AgentStatus; agentName: string; pid: number; subState?: string },
): void {
  const existing = agentCollection.toArray.find((a) => a.ptyId === ptyId);
  if (existing) {
    agentCollection.update(ptyId, (draft) => {
      draft.status = info.status;
      draft.agentName = info.agentName;
      draft.pid = info.pid;
      draft.startedAt = existing.startedAt;
      draft.subState = info.subState;
    });
  } else {
    agentCollection.insert({
      ptyId,
      status: info.status,
      agentName: info.agentName,
      pid: info.pid,
      startedAt: Date.now(),
      manualOverride: false,
      subState: info.subState,
    });
  }
}

export function removeAgent(ptyId: number): void {
  if (agentCollection.toArray.some((a) => a.ptyId === ptyId)) {
    agentCollection.delete(ptyId);
  }
}

export function toggleManualOverride(ptyId: number): void {
  const existing = agentCollection.toArray.find((a) => a.ptyId === ptyId);
  if (existing) {
    agentCollection.update(ptyId, (draft) => {
      draft.manualOverride = !draft.manualOverride;
    });
  } else {
    agentCollection.insert({
      ptyId,
      status: 'working',
      agentName: 'manual',
      pid: 0,
      startedAt: Date.now(),
      manualOverride: true,
    });
  }
}

/** Remove review agents in the given tab's panes.
 * Called when the user switches to a tab — "review" means "finished while
 * you weren't looking", so viewing the tab dismisses it entirely. */
export function clearReviewForTab(tabId: string): void {
  const tabs = getTabCollection().toArray;
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  for (const agent of agentCollection.toArray) {
    if (agent.status === 'review' && containsPtyId(tab.paneRoot, agent.ptyId)) {
      removeAgent(agent.ptyId);
    }
  }
}

export async function initAgentListener(): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');

  const unlisten = await listen<AgentStatusEvent>('agent-status-changed', (event) => {
    const { ptyId, agentName, pid, subState } = event.payload;
    const status = normalizeStatus(event.payload.status);

    if (status === 'idle' || status === 'stopped') {
      // Agent done: if user is looking at the tab, remove immediately.
      // If it's a background tab, mark "review" (done-while-away badge).
      const existing = agentCollection.toArray.find((a) => a.ptyId === ptyId);
      if (status === 'stopped' && !isPtyInActiveTab(ptyId)) {
        setAgent(ptyId, { status: 'review', agentName, pid, subState });
      } else if (existing?.status === 'review') {
        // Don't let a process-watcher idle event clobber a hook-driven review badge
      } else {
        removeAgent(ptyId);
      }
    } else {
      setAgent(ptyId, { status, agentName, pid, subState });
    }
  });

  return unlisten;
}
