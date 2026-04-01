import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { useTabsStore } from '../../stores/tabs-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { StatusBar } from '../StatusBar';

describe('StatusBar', () => {
  afterEach(cleanup);

  beforeEach(() => {
    // Reset store to initial state (1 tab with 1 leaf pane)
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws1',
          paneRoot: { type: 'leaf', id: 'pane-1', ptyId: -1 },
          focusedPaneId: 'pane-1',
        },
      ],
      activeTabId: 'tab-1',
      activeContextId: 'ws1',
    });
    // No workspaces by default
    useWorkspaceStore.setState({
      workspaces: [],
      sidebarVisible: false,
      sidebarWidth: 230,
      selectedItemId: null,
    });
  });

  it('renders "1 pane" for a single leaf tab', () => {
    const { container } = render(<StatusBar />);
    expect(within(container).getByText('1 pane')).toBeInTheDocument();
  });

  it('renders "3 panes" when active tab has 3 leaves', () => {
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal',
          workspaceItemId: 'ws1',
          paneRoot: {
            type: 'branch',
            id: 'branch-1',
            direction: 'horizontal',
            ratios: [0.333, 0.333, 0.334],
            children: [
              { type: 'leaf', id: 'p1', ptyId: 1 },
              { type: 'leaf', id: 'p2', ptyId: 2 },
              { type: 'leaf', id: 'p3', ptyId: 3 },
            ],
          },
          focusedPaneId: 'p1',
        },
      ],
      activeTabId: 'tab-1',
      activeContextId: 'ws1',
    });
    const { container } = render(<StatusBar />);
    expect(within(container).getByText('3 panes')).toBeInTheDocument();
  });

  it('renders shortcut hints', () => {
    const { container } = render(<StatusBar />);
    expect(within(container).getByText('Cmd+D Split')).toBeInTheDocument();
    expect(within(container).getByText('Cmd+T Tab')).toBeInTheDocument();
    expect(within(container).getByText('Cmd+Shift+O Overview')).toBeInTheDocument();
  });

  it('shows "Cmd+B Sidebar" hint text', () => {
    const { container } = render(<StatusBar />);
    expect(within(container).getByText('Cmd+B Sidebar')).toBeInTheDocument();
  });

  it('shows repo name and HEAD branch when workspace exists', () => {
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: 'ws-1',
          path: '/tmp/myrepo',
          name: 'myrepo',
          branches: [
            { name: 'main', is_head: true, ahead: 0, behind: 0 },
          ],
          worktrees: [],
          expanded: true,
        },
      ],
    });
    const { getByText } = render(<StatusBar />);
    expect(getByText('myrepo')).toBeInTheDocument();
    expect(getByText('main')).toBeInTheDocument();
  });

  it('shows only pane count when no workspaces', () => {
    const { container, queryByText } = render(<StatusBar />);
    expect(within(container).getByText('1 pane')).toBeInTheDocument();
    // No repo name should be present
    expect(queryByText('myrepo')).not.toBeInTheDocument();
  });
});
