import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Sidebar } from '../Sidebar';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

describe('Sidebar', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      sidebarVisible: true,
      sidebarWidth: 230,
      selectedItemId: null,
    });
  });

  it('returns null when sidebarVisible is false', () => {
    useWorkspaceStore.setState({ sidebarVisible: false });
    const { container } = render(<Sidebar />);
    expect(container.innerHTML).toBe('');
  });

  it('renders sidebar with correct width from store', () => {
    useWorkspaceStore.setState({ sidebarWidth: 300 });
    const { container } = render(<Sidebar />);
    const sidebar = container.firstElementChild as HTMLElement;
    expect(sidebar.style.width).toBe('300px');
  });

  it('shows empty state text when workspaces array is empty', () => {
    const { getByText } = render(<Sidebar />);
    expect(getByText('No workspaces')).toBeInTheDocument();
    expect(
      getByText('Import a git repository to get started.'),
    ).toBeInTheDocument();
  });

  it('shows "Import Repository" button', () => {
    const { getAllByText } = render(<Sidebar />);
    // Bottom bar button + empty state button
    const buttons = getAllByText('Import Repository');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders resize handle with cursor-col-resize class', () => {
    const { container } = render(<Sidebar />);
    const handle = container.querySelector('.cursor-col-resize');
    expect(handle).toBeInTheDocument();
  });
});
