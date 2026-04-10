import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { Header } from '../Header';

vi.mock('../../lib/project-actions', () => ({ toggleSidebar: vi.fn() }));
vi.mock('../../hooks/useCollections', () => ({
  useProjects: vi.fn(() => [{ id: '1' }]),
  useSettings: vi.fn(() => []),
  useUiState: vi.fn(() => ({ activeContextId: '' })),
}));
vi.mock('../../lib/editor', () => ({
  DEFAULT_EDITOR_SETTING_KEY: 'defaultEditor',
  detectEditors: vi.fn(() => Promise.resolve([])),
  openInEditor: vi.fn(() => Promise.resolve()),
  resolveDefaultEditor: vi.fn(() => undefined),
  useDetectedEditors: vi.fn(() => []),
}));

describe('Header', () => {
  afterEach(cleanup);

  it('renders a header element with drag region', () => {
    const { container } = render(<Header />);
    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
    expect(header?.getAttribute('data-tauri-drag-region')).toBeDefined();
  });

  it('renders sidebar toggle button with accessible label', () => {
    const { getByLabelText } = render(<Header />);
    expect(getByLabelText('Toggle sidebar')).toBeInTheDocument();
  });

  it('hides sidebar toggle button when there are no projects', async () => {
    const { useProjects } = await import('../../hooks/useCollections');
    vi.mocked(useProjects).mockReturnValueOnce([]);
    const { queryByLabelText } = render(<Header />);
    expect(queryByLabelText('Toggle sidebar')).toBeNull();
  });

  it('has 78px left padding for traffic lights', () => {
    const { container } = render(<Header />);
    const header = container.querySelector('header') as HTMLElement;
    expect(header.className).toContain('pl-[78px]');
  });

  it('calls toggleSidebar when button is clicked', async () => {
    const { toggleSidebar } = await import('../../lib/project-actions');
    const { getByLabelText } = render(<Header />);
    getByLabelText('Toggle sidebar').click();
    expect(toggleSidebar).toHaveBeenCalled();
  });

  it('renders "Open in" button when an editor is detected', async () => {
    const { useDetectedEditors, resolveDefaultEditor } = await import('../../lib/editor');
    const { useUiState } = await import('../../hooks/useCollections');
    const cursor = { id: 'cursor', displayName: 'Cursor', cliPath: '/usr/bin/cursor' };
    vi.mocked(useDetectedEditors).mockReturnValue([cursor]);
    vi.mocked(resolveDefaultEditor).mockReturnValue(cursor);
    vi.mocked(useUiState).mockReturnValue({ activeContextId: 'proj1-branch-main' } as any);
    const { getByText } = render(<Header />);
    expect(getByText('Open in Cursor')).toBeInTheDocument();
  });
});
