import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTabsStore } from '../../stores/tabs-store';
import { StatusBar } from '../StatusBar';

describe('StatusBar', () => {
  beforeEach(() => {
    // Reset store to initial state (1 tab with 1 leaf pane)
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal 1',
          paneRoot: { type: 'leaf', id: 'pane-1', ptyId: -1 },
          focusedPaneId: 'pane-1',
        },
      ],
      activeTabId: 'tab-1',
      tabCounter: 1,
    });
  });

  it('renders "1 pane" for a single leaf tab', () => {
    render(<StatusBar />);
    expect(screen.getByText('1 pane')).toBeInTheDocument();
  });

  it('renders "3 panes" when active tab has 3 leaves', () => {
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          label: 'Terminal 1',
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
    });
    render(<StatusBar />);
    expect(screen.getByText('3 panes')).toBeInTheDocument();
  });

  it('renders shortcut hints', () => {
    render(<StatusBar />);
    expect(screen.getByText('Cmd+D Split')).toBeInTheDocument();
    expect(screen.getByText('Cmd+T Tab')).toBeInTheDocument();
    expect(screen.getByText('Cmd+Shift+O Overview')).toBeInTheDocument();
  });
});
