import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const mockGetConnection = vi.fn();
const mockDisconnect = vi.fn();
const mockStartDeviceFlow = vi.fn();
const mockPollToken = vi.fn();

vi.mock('../../lib/github', () => ({
  getConnection: () => mockGetConnection(),
  disconnect: () => mockDisconnect(),
  startDeviceFlow: () => mockStartDeviceFlow(),
  pollToken: (...args: unknown[]) => mockPollToken(...args),
  GITHUB_CONNECTION_KEY: 'github:connection',
}));

vi.mock('@superagent/db', () => ({ setSetting: vi.fn() }));
vi.mock('../../lib/toast', () => ({ showErrorToast: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: () => null }),
  useNavigate: () => mockNavigate,
}));

import SettingsRoute from '../settings';

describe('Settings — GitHub section', () => {
  beforeEach(() => {
    mockGetConnection.mockReset();
    mockDisconnect.mockReset();
    mockStartDeviceFlow.mockReset();
    mockPollToken.mockReset();
  });
  afterEach(cleanup);

  it('shows "Connect GitHub" button when not connected', async () => {
    mockGetConnection.mockResolvedValue(null);
    const { findByText } = render(<SettingsRoute />);
    expect(await findByText('Connect GitHub')).toBeInTheDocument();
  });

  it('shows username and avatar when connected', async () => {
    mockGetConnection.mockResolvedValue({
      username: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
    });
    const { findByText, findByAltText } = render(<SettingsRoute />);
    expect(await findByText('octocat')).toBeInTheDocument();
    expect(await findByAltText('octocat')).toBeInTheDocument();
  });

  it('shows Disconnect button when connected', async () => {
    mockGetConnection.mockResolvedValue({
      username: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
    });
    const { findByText } = render(<SettingsRoute />);
    expect(await findByText('Disconnect')).toBeInTheDocument();
  });
});
