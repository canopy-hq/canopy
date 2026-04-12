import { agentCollection, type AgentStatus } from '@canopy/db';

interface AgentStatusEvent {
  ptyId: number;
  status: string;
  agentName: string;
  pid: number;
  subState?: string;
}

/** Map legacy/backend status strings to the canonical AgentStatus.
 * Returns `'idle'` for statuses that should remove the agent from the collection. */
function normalizeStatus(status: string): AgentStatus | 'idle' {
  switch (status) {
    // Hook-based states (primary path)
    case 'working':
      return 'working';
    case 'permission':
      return 'permission';
    case 'review':
      return 'review';
    // `stopped` is a transient backend event — Phase 4 will derive review/idle
    // based on activeTabId. For now, treat as idle (remove from collection).
    case 'stopped':
      return 'idle';
    // Legacy states (silence-based detection — backward compat during transition)
    case 'running':
      return 'working';
    case 'waiting':
      return 'permission';
    case 'idle':
      return 'idle';
    default:
      return 'idle';
  }
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

export async function initAgentListener(): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');

  const unlisten = await listen<AgentStatusEvent>('agent-status-changed', (event) => {
    const { ptyId, agentName, pid, subState } = event.payload;
    const status = normalizeStatus(event.payload.status);

    if (status === 'idle') {
      removeAgent(ptyId);
    } else {
      setAgent(ptyId, { status, agentName, pid, subState });
    }
  });

  return unlisten;
}
