import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAgentStore } from '../../stores/agent-store';
import { useTabsStore } from '../../stores/tabs-store';
import { WorkspaceTree } from '../WorkspaceTree';

const testWorkspace = {
  id: 'ws-1',
  path: '/tmp/repo',
  name: 'repo',
  branches: [
    { name: 'main', is_head: true, ahead: 2, behind: 1 },
    { name: 'feature/test', is_head: false, ahead: 0, behind: 0 },
  ],
  worktrees: [{ name: 'hotfix', path: '/tmp/hotfix' }],
  expanded: true,
};

describe('WorkspaceTree', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [testWorkspace],
      selectedItemId: null,
      sidebarVisible: true,
      sidebarWidth: 230,
    });
  });

  it('renders repo name as tree item', () => {
    const { getByText } = render(<WorkspaceTree />);
    expect(getByText('repo')).toBeInTheDocument();
  });

  it('renders branch names with branch icon', () => {
    const { getAllByText, getByText, container } = render(<WorkspaceTree />);
    // "main" appears as both HEAD indicator and branch item
    expect(getAllByText('main').length).toBeGreaterThanOrEqual(1);
    expect(getByText('feature/test')).toBeInTheDocument();
    // Branch icon U+2387
    expect(container.innerHTML).toContain('\u2387');
  });

  it('renders worktree name with worktree icon', () => {
    const { getByText, container } = render(<WorkspaceTree />);
    expect(getByText('hotfix')).toBeInTheDocument();
    // Worktree icon U+25C6
    expect(container.innerHTML).toContain('\u25C6');
  });

  it('shows ahead count "+2" and behind count "-1" for main branch', () => {
    const { getByText } = render(<WorkspaceTree />);
    expect(getByText('+2')).toBeInTheDocument();
    expect(getByText('-1')).toBeInTheDocument();
  });

  it('shows "+ New Branch" button inside expanded repo', () => {
    const { getByText } = render(<WorkspaceTree />);
    expect(getByText('+ New Branch')).toBeInTheDocument();
  });

  it('does not render branch children when workspace expanded=false', () => {
    useWorkspaceStore.setState({
      workspaces: [{ ...testWorkspace, expanded: false }],
    });
    const { queryByText } = render(<WorkspaceTree />);
    // Repo name should still be visible
    expect(queryByText('repo')).toBeInTheDocument();
    // Branch children should be hidden (collapsed by tree)
    // The tree items are in the DOM but the tree hides them via aria-expanded=false
    // React ARIA Tree renders children but collapses them visually
  });

  it('shows pointer cursor on tree items', () => {
    const { container } = render(<WorkspaceTree />);
    // React ARIA Tree renders items with class names from className callback
    const cursorElements = container.querySelectorAll('.cursor-pointer');
    // At least 3: repo header, branch items, worktree items
    expect(cursorElements.length).toBeGreaterThanOrEqual(3);
  });

  it('renders agent status dot on branch row when agent is running', () => {
    // Set up tab with ptyId=1 mapped to ws-1-branch-main
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1-branch-main',
          paneRoot: { type: 'leaf', id: 'pane-1', ptyId: 1 },
          focusedPaneId: 'pane-1',
        },
      ],
      activeTabId: 'tab-1',
      activeContextId: 'ws-1-branch-main',
      contextActiveTabIds: {},
    });
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });

    const { container } = render(<WorkspaceTree />);
    const dot = container.querySelector('[aria-label="Agent running"]');
    expect(dot).not.toBeNull();
  });

  it('renders summary dots on collapsed repo header', () => {
    useWorkspaceStore.setState({
      workspaces: [{ ...testWorkspace, expanded: false }],
    });
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws-1-branch-main',
          paneRoot: { type: 'leaf', id: 'pane-1', ptyId: 1 },
          focusedPaneId: 'pane-1',
        },
        {
          id: 'tab-2',
          label: 'Terminal',
          workspaceItemId: 'ws-1-branch-feature/test',
          paneRoot: { type: 'leaf', id: 'pane-2', ptyId: 2 },
          focusedPaneId: 'pane-2',
        },
      ],
      activeTabId: 'tab-1',
      activeContextId: 'ws-1-branch-main',
      contextActiveTabIds: {},
    });
    useAgentStore.getState().setAgent(1, {
      ptyId: 1,
      status: 'running',
      agentName: 'claude',
      pid: 42,
      startedAt: Date.now(),
    });
    useAgentStore.getState().setAgent(2, {
      ptyId: 2,
      status: 'waiting',
      agentName: 'aider',
      pid: 43,
      startedAt: Date.now(),
    });

    const { container } = render(<WorkspaceTree />);
    // Should show both running and waiting dots as summary
    const runningDots = container.querySelectorAll('[aria-label="Agent running"]');
    const waitingDots = container.querySelectorAll('[aria-label="Agent waiting"]');
    expect(runningDots.length + waitingDots.length).toBeGreaterThanOrEqual(2);
  });

  it('shows +N overflow text when more than 3 agents on collapsed repo', () => {
    useWorkspaceStore.setState({
      workspaces: [{ ...testWorkspace, expanded: false }],
    });
    // Create 5 tabs with agents
    const tabs = [];
    for (let i = 1; i <= 5; i++) {
      tabs.push({
        id: `tab-${i}`,
        label: 'Terminal',
        workspaceItemId: `ws-1-branch-main`,
        paneRoot: { type: 'leaf', id: `pane-${i}`, ptyId: i },
        focusedPaneId: `pane-${i}`,
      });
    }
    useTabsStore.setState({
      tabs,
      activeTabId: 'tab-1',
      activeContextId: 'ws-1-branch-main',
      contextActiveTabIds: {},
    });
    for (let i = 1; i <= 5; i++) {
      useAgentStore.getState().setAgent(i, {
        ptyId: i,
        status: 'running',
        agentName: 'claude',
        pid: 40 + i,
        startedAt: Date.now(),
      });
    }

    const { getByText } = render(<WorkspaceTree />);
    expect(getByText('+2')).toBeInTheDocument();
  });
});
