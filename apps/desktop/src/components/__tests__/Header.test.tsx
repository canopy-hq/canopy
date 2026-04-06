import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { Header } from '../Header';

vi.mock('../../lib/project-actions', () => ({ toggleSidebar: vi.fn() }));
vi.mock('../../hooks/useCollections', () => ({
  useProjects: vi.fn(() => [{ id: '1' }]),
  useSettings: vi.fn(() => []),
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
});
