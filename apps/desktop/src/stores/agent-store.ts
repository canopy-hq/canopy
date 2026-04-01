import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface AgentInfo {
  ptyId: number;
  status: 'running' | 'waiting' | 'idle';
  agentName: string;
  pid: number;
  startedAt: number;
  manualOverride: boolean;
}

interface AgentState {
  agents: Record<number, AgentInfo>;

  // Mutations
  setAgent: (ptyId: number, info: Omit<AgentInfo, 'manualOverride'>) => void;
  removeAgent: (ptyId: number) => void;
  toggleManualOverride: (ptyId: number) => void;
  clearAll: () => void;
}

export const useAgentStore = create<AgentState>()(
  immer((set) => ({
    agents: {},

    setAgent: (ptyId, info) =>
      set((state) => {
        const existing = state.agents[ptyId];
        state.agents[ptyId] = {
          ...info,
          manualOverride: existing?.manualOverride ?? false,
        };
      }),

    removeAgent: (ptyId) =>
      set((state) => {
        delete state.agents[ptyId];
      }),

    toggleManualOverride: (ptyId) =>
      set((state) => {
        const agent = state.agents[ptyId];
        if (agent) {
          agent.manualOverride = !agent.manualOverride;
        } else {
          // Create manual-only agent entry (per AGNT-04)
          state.agents[ptyId] = {
            ptyId,
            status: 'running',
            agentName: 'manual',
            pid: 0,
            startedAt: Date.now(),
            manualOverride: true,
          };
        }
      }),

    clearAll: () =>
      set((state) => {
        state.agents = {};
      }),
  })),
);

// Stable selectors (NEVER use filter/map in selectors -- Zustand memory note)
export function selectAgentForPty(ptyId: number) {
  return (state: AgentState) => state.agents[ptyId];
}

export function selectRunningCount(state: AgentState): number {
  let count = 0;
  for (const key in state.agents) {
    if (state.agents[key]!.status === 'running') count++;
  }
  return count;
}

export function selectWaitingCount(state: AgentState): number {
  let count = 0;
  for (const key in state.agents) {
    if (state.agents[key]!.status === 'waiting') count++;
  }
  return count;
}

// Event listener initialization (lazy import pattern from theme-store)
let unlistenFn: (() => void) | null = null;

export async function initAgentListener(): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');

  interface AgentStatusEvent {
    ptyId: number;
    status: 'running' | 'waiting' | 'idle';
    agentName: string;
    pid: number;
  }

  const unlisten = await listen<AgentStatusEvent>('agent-status-changed', (event) => {
    const { ptyId, status, agentName, pid } = event.payload;

    if (status === 'idle') {
      useAgentStore.getState().removeAgent(ptyId);
    } else {
      useAgentStore.getState().setAgent(ptyId, {
        ptyId,
        status,
        agentName,
        pid,
        startedAt: Date.now(),
      });
    }
  });

  unlistenFn = unlisten;
  return unlisten;
}

export function cleanupAgentListener() {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
}
