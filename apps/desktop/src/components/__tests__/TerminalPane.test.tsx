import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useAgentStore } from '../../stores/agent-store';
import { useTabsStore } from '../../stores/tabs-store';

// Mock useTerminal hook to avoid xterm.js dependency in tests
vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(),
}));

// Mock pty spawn
vi.mock('../../lib/pty', () => ({
  spawnTerminal: vi.fn(() => Promise.resolve(1)),
}));

// Import after mocks
import { TerminalPane } from '../TerminalPane';

describe('TerminalPane agent status integration', () => {
  afterEach(cleanup);

  beforeEach(() => {
    // Reset agent store
    useAgentStore.setState({ agents: {} });
    // Set up a basic tab store so TerminalPane can render
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

  it('renders amber border glow when agent is in waiting state', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'waiting',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container } = render(<TerminalPane paneId="pane-1" ptyId={1} />);
    const wrapper = container.querySelector('[data-testid="terminal-pane-wrapper"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.border).toContain('var(--agent-waiting-border)');
    expect(wrapper.style.boxShadow).toContain('var(--agent-waiting-glow)');
    expect(wrapper.style.boxShadow).toContain('var(--agent-waiting-inset)');
  });

  it('does not render amber glow when agent is running', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container } = render(<TerminalPane paneId="pane-1" ptyId={1} />);
    const wrapper = container.querySelector('[data-testid="terminal-pane-wrapper"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.border).not.toContain('agent-waiting-border');
    expect(wrapper.style.boxShadow).toBe('none');
  });

  it('does not render amber glow when no agent', () => {
    const { container } = render(<TerminalPane paneId="pane-1" ptyId={1} />);
    const wrapper = container.querySelector('[data-testid="terminal-pane-wrapper"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.border).not.toContain('agent-waiting-border');
    expect(wrapper.style.boxShadow).toBe('none');
  });

  it('passes agent status and name to PaneHeader', () => {
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container } = render(<TerminalPane paneId="pane-1" ptyId={1} />);
    // StatusDot should be present with running status
    const dot = container.querySelector('[aria-label="Agent running"]');
    expect(dot).not.toBeNull();
    // Agent name should be rendered
    expect(container.textContent).toContain('claude');
  });
});
