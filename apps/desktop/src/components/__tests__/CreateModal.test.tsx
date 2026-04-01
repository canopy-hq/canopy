import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, within, fireEvent } from '@testing-library/react';
import { CreateModal } from '../CreateModal';
import { useWorkspaceStore } from '../../stores/workspace-store';
import type { Workspace } from '../../stores/workspace-store';

// Mock workspace store actions
const mockCreateBranch = vi.fn().mockResolvedValue(undefined);
const mockCreateWorktree = vi.fn().mockResolvedValue(undefined);

const testWorkspace: Workspace = {
  id: 'ws-1',
  path: '/tmp/repo',
  name: 'my-repo',
  branches: [
    { name: 'main', is_head: true, ahead: 0, behind: 0 },
    { name: 'develop', is_head: false, ahead: 1, behind: 0 },
  ],
  worktrees: [],
  expanded: true,
};

describe('CreateModal', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockCreateBranch.mockClear();
    mockCreateWorktree.mockClear();
    useWorkspaceStore.setState({
      workspaces: [testWorkspace],
      createBranch: mockCreateBranch,
      createWorktree: mockCreateWorktree,
    } as any);
  });

  it('renders modal title when isOpen=true', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    expect(within(container).getByText('Create Branch or Worktree')).toBeInTheDocument();
  });

  it('does not render content when isOpen=false', () => {
    const { container } = render(
      <CreateModal isOpen={false} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders two type cards: Branch and Worktree', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    expect(within(container).getByText('Branch')).toBeInTheDocument();
    expect(within(container).getByText('Worktree')).toBeInTheDocument();
  });

  it('renders branch icon in type card', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    // U+2387 branch icon
    expect(within(container).getByText('\u2387')).toBeInTheDocument();
  });

  it('renders worktree icon in type card', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    // U+25C6 worktree icon
    expect(within(container).getByText('\u25C6')).toBeInTheDocument();
  });

  it('renders name input with correct placeholder', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const input = container.querySelector('input[placeholder="feature/my-branch"]');
    expect(input).toBeInTheDocument();
  });

  it('renders base branch dropdown with branches', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const select = container.querySelector('select');
    expect(select).toBeInTheDocument();
    const options = select!.querySelectorAll('option');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe('main (HEAD)');
    expect(options[1].textContent).toBe('develop');
  });

  it('shows git branch preview by default', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('git branch');
    expect(code?.textContent).toContain('main');
  });

  it('updates preview when typing name', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'feat/foo' } });
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('git branch feat/foo main');
  });

  it('changes button label to "Create Worktree" when worktree type selected', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const worktreeCard = within(container).getByText('Worktree').closest('button')!;
    fireEvent.click(worktreeCard);
    expect(within(container).getByText('Create Worktree')).toBeInTheDocument();
  });

  it('changes preview to git worktree add format when worktree selected', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const worktreeCard = within(container).getByText('Worktree').closest('button')!;
    fireEvent.click(worktreeCard);
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('git worktree add');
  });

  it('shows worktree path when worktree type selected', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const worktreeCard = within(container).getByText('Worktree').closest('button')!;
    fireEvent.click(worktreeCard);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'feat/foo' } });
    expect(container.textContent).toContain('~/.superagent/worktrees/my-repo-feat/foo');
  });

  it('disables create button when name is empty', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const createBtn = within(container).getByText('Create Branch');
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name has text', () => {
    const { container } = render(
      <CreateModal isOpen={true} onClose={vi.fn()} workspace={testWorkspace} />,
    );
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'test-branch' } });
    const createBtn = within(container).getByText('Create Branch');
    expect(createBtn).not.toBeDisabled();
  });

  it('calls onClose when Discard button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CreateModal isOpen={true} onClose={onClose} workspace={testWorkspace} />,
    );
    const discardBtn = within(container).getByText('Discard');
    fireEvent.click(discardBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
