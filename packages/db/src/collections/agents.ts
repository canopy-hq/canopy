import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

/** Agent status values stored in the collection.
 * `stopped` is intentionally excluded — it's a transient backend event
 * that gets derived to `review` or `idle` before collection insertion. */
export type AgentStatus = 'idle' | 'working' | 'permission' | 'review';

export interface AgentInfo {
  ptyId: number;
  status: AgentStatus;
  agentName: string;
  pid: number;
  startedAt: number;
  manualOverride: boolean;
  subState?: string;
}

// In-memory only — agent state is ephemeral runtime data, not persisted
export const agentCollection = createCollection(
  localOnlyCollectionOptions<AgentInfo, number>({ getKey: (a) => a.ptyId }),
);
