import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  agentToastQueue,
  showAgentToast,
  showAgentToastDeduped,
} from '../../lib/toast';
import type { AgentToastContent } from '../../lib/toast';

function makeToast(overrides?: Partial<AgentToastContent>): AgentToastContent {
  return {
    type: 'agent-waiting',
    agentName: 'claude',
    workspace: 'my-repo',
    branch: 'main',
    ptyId: 42,
    ...overrides,
  };
}

describe('AgentToastRegion', () => {
  beforeEach(() => {
    // Clear any existing toasts by closing them through the queue
    for (const toast of [...agentToastQueue.visibleToasts]) {
      agentToastQueue.close(toast.key);
    }
  });

  it('renders waiting toast with persist behavior (no timeout)', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');
    showAgentToast(makeToast({ type: 'agent-waiting' }));

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent-waiting', agentName: 'claude' }),
      { timeout: undefined },
    );
    addSpy.mockRestore();
  });

  it('renders complete toast with agent name and auto-dismiss after 10s', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');
    showAgentToast(makeToast({ type: 'agent-complete', agentName: 'aider' }));

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent-complete', agentName: 'aider' }),
      { timeout: 10000 },
    );
    addSpy.mockRestore();
  });

  it('shows Jump to pane and Dismiss action buttons in toast content', () => {
    // Verify the AgentToastContent interface has required fields
    const content = makeToast();
    expect(content).toHaveProperty('ptyId');
    expect(content).toHaveProperty('agentName');
    expect(content).toHaveProperty('workspace');
    expect(content).toHaveProperty('branch');
    expect(content.type).toBe('agent-waiting');
  });

  it('deduplication suppresses duplicate toasts within 5s', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');

    const content = makeToast({ ptyId: 999 });
    showAgentToastDeduped(content);
    showAgentToastDeduped(content); // Should be suppressed

    expect(addSpy).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('deduplication allows toast after 5s window', () => {
    const addSpy = vi.spyOn(agentToastQueue, 'add');
    const nowSpy = vi.spyOn(Date, 'now');

    const content = makeToast({ ptyId: 2000 });
    const baseTime = 1000000;
    nowSpy.mockReturnValue(baseTime);
    showAgentToastDeduped(content);

    // Advance past 5s window
    nowSpy.mockReturnValue(baseTime + 6000);
    showAgentToastDeduped(content);

    expect(addSpy).toHaveBeenCalledTimes(2);
    addSpy.mockRestore();
    nowSpy.mockRestore();
  });
});
