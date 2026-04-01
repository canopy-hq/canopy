import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAgentStore,
  selectAgentForPty,
  selectRunningCount,
  selectWaitingCount,
} from '../agent-store';

beforeEach(() => {
  useAgentStore.getState().clearAll();
});

describe('agent-store', () => {
  it('setAgent stores agent info keyed by ptyId', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });

    const agent = useAgentStore.getState().agents[1];
    expect(agent).toBeDefined();
    expect(agent!.ptyId).toBe(1);
    expect(agent!.status).toBe('running');
    expect(agent!.agentName).toBe('claude');
    expect(agent!.pid).toBe(42);
    expect(agent!.manualOverride).toBe(false);
  });

  it('setAgent preserves existing manualOverride', () => {
    // First set with manual override
    useAgentStore.getState().toggleManualOverride(1);
    expect(useAgentStore.getState().agents[1]!.manualOverride).toBe(true);

    // Update agent -- manualOverride should be preserved
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'waiting',
      agentName: 'claude',
      pid: 42,
      startedAt: 2000,
    });

    const agent = useAgentStore.getState().agents[1];
    expect(agent!.manualOverride).toBe(true);
    expect(agent!.status).toBe('waiting');
  });

  it('removeAgent deletes agent entry', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });

    useAgentStore.getState().removeAgent(1);
    expect(useAgentStore.getState().agents[1]).toBeUndefined();
  });

  it('toggleManualOverride flips boolean on existing agent', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });

    expect(useAgentStore.getState().agents[1]!.manualOverride).toBe(false);
    useAgentStore.getState().toggleManualOverride(1);
    expect(useAgentStore.getState().agents[1]!.manualOverride).toBe(true);
    useAgentStore.getState().toggleManualOverride(1);
    expect(useAgentStore.getState().agents[1]!.manualOverride).toBe(false);
  });

  it('toggleManualOverride creates manual entry when no agent exists', () => {
    useAgentStore.getState().toggleManualOverride(5);

    const agent = useAgentStore.getState().agents[5];
    expect(agent).toBeDefined();
    expect(agent!.agentName).toBe('manual');
    expect(agent!.status).toBe('running');
    expect(agent!.manualOverride).toBe(true);
    expect(agent!.pid).toBe(0);
  });

  it('selectRunningCount returns count of running agents', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });
    useAgentStore.getState().setAgent(2, {
      ptyId: 2,
      status: 'waiting',
      agentName: 'codex',
      pid: 43,
      startedAt: 1000,
    });
    useAgentStore.getState().setAgent(3, {
      ptyId: 3,
      status: 'running',
      agentName: 'aider',
      pid: 44,
      startedAt: 1000,
    });

    expect(selectRunningCount(useAgentStore.getState())).toBe(2);
  });

  it('selectWaitingCount returns count of waiting agents', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });
    useAgentStore.getState().setAgent(2, {
      ptyId: 2,
      status: 'waiting',
      agentName: 'codex',
      pid: 43,
      startedAt: 1000,
    });

    expect(selectWaitingCount(useAgentStore.getState())).toBe(1);
  });

  it('clearAll removes all agents', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });
    useAgentStore.getState().setAgent(2, {
      ptyId: 2,
      status: 'waiting',
      agentName: 'codex',
      pid: 43,
      startedAt: 1000,
    });

    useAgentStore.getState().clearAll();
    expect(Object.keys(useAgentStore.getState().agents)).toHaveLength(0);
  });

  it('selectAgentForPty returns stable selector', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: 1000,
    });

    const selector = selectAgentForPty(1);
    const agent = selector(useAgentStore.getState());
    expect(agent).toBeDefined();
    expect(agent!.agentName).toBe('claude');

    const noAgent = selectAgentForPty(999)(useAgentStore.getState());
    expect(noAgent).toBeUndefined();
  });
});
