import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useAgentStore } from '../../stores/agent-store';
import { useTabsStore } from '../../stores/tabs-store';
import { TabBar } from '../TabBar';

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

describe('TabBar agent status indicators', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useAgentStore.setState({ agents: {} });
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws1',
          paneRoot: { type: 'leaf', id: 'pane-1', ptyId: 1 },
          focusedPaneId: 'pane-1',
        },
      ],
      activeTabId: 'tab-1',
      activeContextId: 'ws1',
      contextActiveTabIds: {},
    });
  });

  it('renders status dot on tab when agent is running', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container } = render(<TabBar />);
    const dot = container.querySelector('[aria-label="Agent running"]');
    expect(dot).not.toBeNull();
  });

  it('renders amber tint and input badge when agent is waiting', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'waiting',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container, getByText } = render(<TabBar />);
    // Input badge should be present
    expect(getByText('input')).toBeInTheDocument();
    // Amber breathing dot
    const dot = container.querySelector('[aria-label="Agent waiting"]');
    expect(dot).not.toBeNull();
    // Tab button should have amber background
    const tabButton = container.querySelector('button[title="Terminal"]') as HTMLElement;
    expect(tabButton.style.backgroundColor).toBe('var(--agent-waiting-glow)');
  });

  it('no dot or badge when idle', () => {
    const { container, queryByText } = render(<TabBar />);
    const dot = container.querySelector('[aria-label="Agent running"]');
    expect(dot).toBeNull();
    const waitingDot = container.querySelector('[aria-label="Agent waiting"]');
    expect(waitingDot).toBeNull();
    expect(queryByText('input')).toBeNull();
  });
});
