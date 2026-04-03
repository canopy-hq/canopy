import { agentCollection } from '@superagent/db';

interface AgentStatusEvent {
  ptyId: number;
  status: 'running' | 'waiting' | 'idle';
  agentName: string;
  pid: number;
}

export function setAgent(
  ptyId: number,
  info: Omit<AgentStatusEvent, 'ptyId'> & { ptyId: number },
): void {
  const existing = agentCollection.toArray.find((a) => a.ptyId === ptyId);
  if (existing) {
    agentCollection.update(ptyId, (draft) => {
      draft.status = info.status;
      draft.agentName = info.agentName;
      draft.pid = info.pid;
      draft.startedAt = existing.startedAt;
    });
  } else {
    agentCollection.insert({
      ptyId: info.ptyId,
      status: info.status,
      agentName: info.agentName,
      pid: info.pid,
      startedAt: Date.now(),
      manualOverride: false,
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
      status: 'running',
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
    const { ptyId, status, agentName, pid } = event.payload;
    if (status === 'idle') {
      removeAgent(ptyId);
    } else {
      setAgent(ptyId, { ptyId, status, agentName, pid });
    }
  });

  return unlisten;
}
