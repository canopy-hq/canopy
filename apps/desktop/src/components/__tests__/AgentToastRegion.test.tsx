import { describe, it, expect, beforeEach, vi } from 'vitest';

import { agentToastQueue, showAgentToastDeduped, dismissAgentToast } from '../../lib/toast';

import type { AgentToastContent } from '../../lib/toast';

function makeToast(overrides?: Partial<AgentToastContent>): AgentToastContent {
  return {
    type: 'agent-waiting',
    agentName: 'claude',
    project: 'my-repo',
    branch: 'main',
    ptyId: 42,
    ...overrides,
  };
}

describe('AgentToastRegion', () => {
  beforeEach(() => {
    for (const toast of agentToastQueue.visibleToasts) {
      agentToastQueue.close(toast.key);
    }
  });

  it('waiting toast has no timeout (persists until dismissed)', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');
    showAgentToastDeduped(makeToast({ type: 'agent-waiting', ptyId: 100 }));

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent-waiting', agentName: 'claude' }),
      expect.objectContaining({ timeout: undefined }),
    );
    addSpy.mockRestore();
  });

  it('complete toast auto-dismisses after 10s', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');
    showAgentToastDeduped(makeToast({ type: 'agent-complete', agentName: 'aider', ptyId: 101 }));

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent-complete', agentName: 'aider' }),
      expect.objectContaining({ timeout: 10000 }),
    );
    addSpy.mockRestore();
  });

  it('toast content includes all required fields', () => {
    const content = makeToast();
    expect(content).toHaveProperty('ptyId');
    expect(content).toHaveProperty('agentName');
    expect(content).toHaveProperty('project');
    expect(content).toHaveProperty('branch');
    expect(content.type).toBe('agent-waiting');
  });

  it('deduplication suppresses duplicate toasts for same ptyId', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');

    const content = makeToast({ ptyId: 999 });
    showAgentToastDeduped(content);
    showAgentToastDeduped(content); // Should be suppressed

    expect(addSpy).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('allows new toast after previous one is dismissed', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');

    const content = makeToast({ ptyId: 2000 });
    showAgentToastDeduped(content);

    // Dismiss the active toast
    dismissAgentToast(2000);

    showAgentToastDeduped(content);
    expect(addSpy).toHaveBeenCalledTimes(2);
    addSpy.mockRestore();
  });

  it('different ptyIds can have concurrent toasts', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');

    showAgentToastDeduped(makeToast({ ptyId: 10 }));
    showAgentToastDeduped(makeToast({ ptyId: 20 }));

    expect(addSpy).toHaveBeenCalledTimes(2);
    addSpy.mockRestore();
  });
});
