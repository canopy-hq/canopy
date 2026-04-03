import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WorkspacePalette, type WorkspacePaletteProps } from '../WorkspacePalette';

vi.mock('../../lib/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/git')>();
  return {
    ...actual,
    listAllBranches: vi.fn().mockResolvedValue([
      { name: 'main', is_head: true, is_local: true, is_in_worktree: false },
      { name: 'develop', is_head: false, is_local: false, is_in_worktree: false },
      { name: 'feat/auth', is_head: false, is_local: true, is_in_worktree: false },
      { name: 'feat/sidebar', is_head: false, is_local: true, is_in_worktree: true },
    ]),
    listBranches: vi.fn().mockResolvedValue([]),
    listWorktrees: vi
      .fn()
      .mockResolvedValue([{ name: 'wt-sidebar', path: '/tmp/wt-sidebar', branch: 'feat/sidebar' }]),
  };
});

vi.mock('../../lib/workspace-actions', () => ({ createWorktree: vi.fn(), openWorktree: vi.fn() }));

const baseWorkspace = {
  id: 'ws-1',
  path: '/tmp/repo',
  name: 'my-repo',
  branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
  worktrees: [{ name: 'wt-sidebar', path: '/tmp/wt-sidebar', branch: 'feat/sidebar' }],
  expanded: true,
  position: 0,
};

describe('WorkspacePalette', () => {
  let props: WorkspacePaletteProps;

  beforeEach(() => {
    props = { isOpen: true, onClose: vi.fn(), workspace: baseWorkspace };
  });

  it('renders nothing when isOpen is false', () => {
    render(<WorkspacePalette {...props} isOpen={false} />);
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull();
  });

  it('renders search input when open', () => {
    render(<WorkspacePalette {...props} />);
    expect(screen.getByPlaceholderText(/Search or create/)).toBeDefined();
  });

  it('shows All and Worktrees tabs', () => {
    render(<WorkspacePalette {...props} />);
    expect(screen.getByText(/All/)).toBeDefined();
    expect(screen.getAllByText(/Worktrees/).length).toBeGreaterThanOrEqual(1);
  });

  it('closes on Escape', () => {
    render(<WorkspacePalette {...props} />);
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    render(<WorkspacePalette {...props} />);
    fireEvent.click(screen.getByRole('presentation'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
