import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { AgentOverlay } from '../AgentOverlay';
import { useAgentStore } from '../../stores/agent-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useTabsStore } from '../../stores/tabs-store';

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

// Mock workspace store's git imports
vi.mock('../../lib/git', () => ({
  importRepo: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
  showErrorToast: vi.fn(),
}));

function setupStores(opts?: {
  agents?: Record<number, any>;
  workspaces?: any[];
  tabs?: any[];
}) {
  useAgentStore.setState({ agents: opts?.agents ?? {} });
  useWorkspaceStore.setState({
    workspaces: opts?.workspaces ?? [],
  } as any);
  useTabsStore.setState({
    tabs: opts?.tabs ?? [],
    activeTabId: '',
    activeContextId: '',
    contextActiveTabIds: {},
  } as any);
}

describe('AgentOverlay', () => {
  afterEach(cleanup);

  beforeEach(() => {
    setupStores();
  });

  it('renders empty state when no agents', () => {
    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('No agents running');
    expect(container.textContent).toContain('Start an AI agent in any terminal to see it here');
  });

  it('does not render when isOpen=false', () => {
    const { container } = render(<AgentOverlay isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders agent rows grouped by workspace', () => {
    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'running' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: Date.now() - 60000,
          manualOverride: false,
        },
        2: {
          ptyId: 2,
          status: 'running' as const,
          agentName: 'aider',
          pid: 200,
          startedAt: Date.now() - 120000,
          manualOverride: false,
        },
      },
      workspaces: [
        {
          id: 'ws-1',
          name: 'repo-alpha',
          path: '/tmp/alpha',
          expanded: true,
          branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
          worktrees: [],
        },
        {
          id: 'ws-2',
          name: 'repo-beta',
          path: '/tmp/beta',
          expanded: true,
          branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
          worktrees: [],
        },
      ],
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1',
          paneRoot: { type: 'leaf', id: 'p1', ptyId: 1 },
          focusedPaneId: 'p1',
        },
        {
          id: 'tab-2',
          label: 'Terminal',
          workspaceItemId: 'ws-2',
          paneRoot: { type: 'leaf', id: 'p2', ptyId: 2 },
          focusedPaneId: 'p2',
        },
      ],
    });

    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('repo-alpha');
    expect(container.textContent).toContain('repo-beta');
    expect(container.textContent).toContain('claude');
    expect(container.textContent).toContain('aider');
  });

  it('shows duration in correct format', () => {
    const now = Date.now();
    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'running' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: now - 42000, // 42 seconds ago
          manualOverride: false,
        },
      },
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1',
          paneRoot: { type: 'leaf', id: 'p1', ptyId: 1 },
          focusedPaneId: 'p1',
        },
      ],
    });

    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    // Should show ~42s
    expect(container.textContent).toMatch(/4[0-4]s/);
  });

  it('keyboard ArrowDown/ArrowUp changes selection', () => {
    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'running' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: Date.now(),
          manualOverride: false,
        },
        2: {
          ptyId: 2,
          status: 'running' as const,
          agentName: 'aider',
          pid: 200,
          startedAt: Date.now(),
          manualOverride: false,
        },
      },
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1',
          paneRoot: { type: 'leaf', id: 'p1', ptyId: 1 },
          focusedPaneId: 'p1',
        },
        {
          id: 'tab-2',
          label: 'Terminal',
          workspaceItemId: 'ws-2',
          paneRoot: { type: 'leaf', id: 'p2', ptyId: 2 },
          focusedPaneId: 'p2',
        },
      ],
    });

    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    // The panel div wraps the Dialog and has the onKeyDown handler
    const panel = container.querySelector('[role="dialog"]')!.parentElement!;

    // First row should be selected by default
    const row1 = container.querySelector('[data-testid="agent-row-1"]')!;
    expect(row1.getAttribute('data-selected')).toBe('true');

    // ArrowDown -> second row selected
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    const row2 = container.querySelector('[data-testid="agent-row-2"]')!;
    expect(row2.getAttribute('data-selected')).toBe('true');

    // ArrowUp -> back to first row
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(container.querySelector('[data-testid="agent-row-1"]')!.getAttribute('data-selected')).toBe('true');
  });

  it('Enter key triggers jump to workspace', () => {
    const mockSwitchTab = vi.fn();
    const mockSetActiveContext = vi.fn();

    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'running' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: Date.now(),
          manualOverride: false,
        },
      },
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1',
          paneRoot: { type: 'leaf', id: 'p1', ptyId: 1 },
          focusedPaneId: 'p1',
        },
      ],
    });

    useTabsStore.setState({
      switchTab: mockSwitchTab,
      setActiveContext: mockSetActiveContext,
    } as any);

    const onClose = vi.fn();
    const { container } = render(<AgentOverlay isOpen={true} onClose={onClose} />);
    const panel = container.querySelector('[role="dialog"]')!.parentElement!;

    fireEvent.keyDown(panel, { key: 'Enter' });
    expect(mockSetActiveContext).toHaveBeenCalledWith('ws-1');
    expect(mockSwitchTab).toHaveBeenCalledWith('tab-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc key closes overlay', () => {
    const onClose = vi.fn();
    const { container } = render(<AgentOverlay isOpen={true} onClose={onClose} />);
    const panel = container.querySelector('[role="dialog"]')!.parentElement!;

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders counter pill with running and waiting counts', () => {
    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'running' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: Date.now(),
          manualOverride: false,
        },
        2: {
          ptyId: 2,
          status: 'waiting' as const,
          agentName: 'aider',
          pid: 200,
          startedAt: Date.now(),
          manualOverride: false,
        },
      },
      tabs: [],
    });

    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('1 running');
    expect(container.textContent).toContain('1 waiting');
  });

  it('waiting row has amber tint background', () => {
    setupStores({
      agents: {
        1: {
          ptyId: 1,
          status: 'waiting' as const,
          agentName: 'claude',
          pid: 100,
          startedAt: Date.now(),
          manualOverride: false,
        },
      },
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1',
          paneRoot: { type: 'leaf', id: 'p1', ptyId: 1 },
          focusedPaneId: 'p1',
        },
      ],
    });

    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    const row = container.querySelector('[data-testid="agent-row-1"]') as HTMLElement;
    expect(row.style.background).toBe('var(--agent-waiting-glow)');
  });

  it('clicking backdrop closes overlay', () => {
    const onClose = vi.fn();
    const { container } = render(<AgentOverlay isOpen={true} onClose={onClose} />);
    // The backdrop is the outermost div with role="presentation"
    const backdrop = container.querySelector('[role="presentation"]')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders Agent Overview title', () => {
    const { container } = render(<AgentOverlay isOpen={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('Agent Overview');
  });
});
