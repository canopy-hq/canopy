import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

import { ProjectPalettePanel, type ProjectPalettePanelProps } from '../ProjectPalette';

// scrollIntoView is not implemented in jsdom
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../lib/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/git')>();
  return {
    ...actual,
    fetchRemote: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../lib/project-actions', () => ({ createWorktree: vi.fn(), openWorktree: vi.fn() }));

const baseProject = {
  id: 'proj-1',
  path: '/tmp/repo',
  name: 'my-repo',
  branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
  worktrees: [{ name: 'wt-sidebar', path: '/tmp/wt-sidebar', branch: 'feat/sidebar' }],
  expanded: true,
  position: 0,
};

describe('ProjectPalettePanel', () => {
  let props: ProjectPalettePanelProps;

  beforeEach(() => {
    props = { project: baseProject, ctx: { close: vi.fn(), back: vi.fn() } };
  });

  it('renders search input', () => {
    render(<ProjectPalettePanel {...props} />);
    expect(screen.getByPlaceholderText(/Search or create/)).toBeDefined();
  });

  it('shows All and Worktrees tab chips', () => {
    render(<ProjectPalettePanel {...props} />);
    expect(screen.getByText(/All/)).toBeDefined();
    expect(screen.getByText(/Worktrees/)).toBeDefined();
  });

  it('calls ctx.close on Escape (always closes, never back)', () => {
    render(<ProjectPalettePanel {...props} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/Search or create/), { key: 'Escape' });
    expect(props.ctx.close).toHaveBeenCalledTimes(1);
    expect(props.ctx.back).not.toHaveBeenCalled();
  });

  it('arrow keys navigate between loaded items', async () => {
    const { container } = render(<ProjectPalettePanel {...props} />);
    const input = screen.getByPlaceholderText(/Search or create/);

    // Wait for branches to load from the async mock
    await waitFor(() => {
      expect(container.querySelectorAll('[data-id]').length).toBeGreaterThan(1);
    });

    const firstSelected = container
      .querySelector('[aria-selected="true"]')
      ?.getAttribute('data-id');
    expect(firstSelected).toBeTruthy();

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const secondSelected = container
      .querySelector('[aria-selected="true"]')
      ?.getAttribute('data-id');
    expect(secondSelected).toBeTruthy();
    expect(secondSelected).not.toBe(firstSelected);
  });

  it('calls ctx.back on Backspace with empty query', () => {
    render(<ProjectPalettePanel {...props} />);
    const input = screen.getByPlaceholderText(/Search or create/);
    // input value is already empty — Backspace should navigate back
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(props.ctx.back).toHaveBeenCalledTimes(1);
    expect(props.ctx.close).not.toHaveBeenCalled();
  });

  it('does not blur input on list item mousedown', async () => {
    const { container } = render(<ProjectPalettePanel {...props} />);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-id]').length).toBeGreaterThan(0);
    });

    const row = container.querySelector('[data-id]');
    if (row) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});
