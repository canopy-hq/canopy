import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const mockGetConnection = vi.fn();

vi.mock('../../lib/github', () => ({
  getConnection: () => mockGetConnection(),
  disconnect: vi.fn().mockResolvedValue(undefined),
  startDeviceFlow: vi.fn(),
  pollToken: vi.fn(),
  cancelPoll: vi.fn().mockResolvedValue(undefined),
  GITHUB_CONNECTION_KEY: 'github:connection',
}));

vi.mock('@superagent/db', () => ({
  setSetting: vi.fn(),
  getSetting: (_s: unknown[], _k: string, fallback: unknown) => fallback,
  getSettingCollection: () => ({ toArray: [] }),
}));
vi.mock('@tanstack/react-db', () => ({ useLiveQuery: () => ({ data: [] }) }));
vi.mock('../../lib/toast', () => ({ showErrorToast: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../lib/git', () => ({ WORKTREE_BASE_DIR_KEY: 'worktreeBaseDir' }));

import { ConnectionSection } from '../settings/ConnectionSection';

describe('ConnectionSection', () => {
  beforeEach(() => mockGetConnection.mockReset());
  afterEach(cleanup);

  it('renders GitHub heading', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText } = render(<ConnectionSection />);
    expect(await findByText('GitHub')).toBeInTheDocument();
  });

  it('shows Connect GitHub button when disconnected', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText } = render(<ConnectionSection />);
    expect(await findByText('Connect GitHub')).toBeInTheDocument();
  });

  it('shows username when connected', async () => {
    mockGetConnection.mockResolvedValue({
      username: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
    });
    const { findByText } = render(<ConnectionSection />);
    expect(await findByText('octocat')).toBeInTheDocument();
  });

  it('renders Worktree Base Directory section', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText } = render(<ConnectionSection />);
    expect(await findByText('Worktree Base Directory')).toBeInTheDocument();
  });

  it('shows default path when no custom dir is set', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText } = render(<ConnectionSection />);
    expect(await findByText('~/.superagent/worktrees')).toBeInTheDocument();
  });

  it('does not show Reset button when using default path', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText, queryByText } = render(<ConnectionSection />);
    await findByText('Worktree Base Directory');
    expect(queryByText('Reset')).not.toBeInTheDocument();
  });
});
