import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

export interface AgentInfo {
  ptyId: number;
  status: 'running' | 'waiting' | 'idle';
  agentName: string;
  pid: number;
  startedAt: number;
  manualOverride: boolean;
}

// In-memory only — agent state is ephemeral runtime data, not persisted
export const agentCollection = createCollection(
  localOnlyCollectionOptions<AgentInfo, number>({
    getKey: (a) => a.ptyId,
  }),
);
