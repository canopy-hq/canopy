import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

/** Status values that can be stored in the agent collection.
 * `stopped` is intentionally excluded — it's a transient backend event
 * that gets derived to `review` or removed (idle) before collection insertion. */
export type AgentStatus =
  // Legacy states (silence-based detection) — kept during transition
  | 'running'
  | 'waiting'
  // Hook-based states
  | 'working'
  | 'permission'
  | 'review';

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
