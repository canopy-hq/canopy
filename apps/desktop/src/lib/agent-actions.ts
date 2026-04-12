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

/** Map legacy/backend status strings to the canonical AgentStatus.
 * Returns `'idle'` for statuses that should remove the agent from the collection.
 * `'stopped'` is handled separately in initAgentListener (needs focus check). */
function normalizeStatus(status: string): AgentStatus | 'idle' | 'stopped' {
  switch (status) {
    case 'working':
      return 'working';
    case 'permission':
      return 'permission';
    case 'review':
      return 'review';
    case 'stopped':
      return 'stopped';
    case 'idle':
      return 'idle';
    default:
      return 'idle';
  }
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

/** Clear review state for all agents in the given tab's panes. */
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

    if (status === 'idle') {
      removeAgent(ptyId);
    } else if (status === 'stopped') {
      // Derive review/idle based on whether the pane's tab is active:
      // - Active tab → agent is done and user can see it → idle (remove)
      // - Background tab → agent finished while user wasn't looking → review
      if (isPtyInActiveTab(ptyId)) {
        removeAgent(ptyId);
      } else {
        setAgent(ptyId, { status: 'review', agentName, pid, subState });
      }
    } else {
      setAgent(ptyId, { status, agentName, pid, subState });
    }
  });

  return unlisten;
}
