import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../lib/github', () => ({
  getConnection: vi.fn().mockResolvedValue(null),
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
  getUiState: () => ({ activeContextId: 'ws-1' }),
}));

vi.mock('@tanstack/react-db', () => ({ useLiveQuery: () => ({ data: [] }) }));

vi.mock('../../lib/toast', () => ({ showErrorToast: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: () => null }),
  useNavigate: () => mockNavigate,
}));

import SettingsRoute from '../settings';

describe('Settings route', () => {
  afterEach(cleanup);

  it('renders sidebar with section headers', () => {
    const { getByText } = render(<SettingsRoute />);
    expect(getByText('Personal')).toBeInTheDocument();
    expect(getByText('Editor & Workflow')).toBeInTheDocument();
  });

  it('renders Appearance nav item as active by default', () => {
    const { getByText } = render(<SettingsRoute />);
    expect(getByText('Appearance')).toBeInTheDocument();
  });

  it('renders Git nav item', () => {
    const { getByText } = render(<SettingsRoute />);
    expect(getByText('Git')).toBeInTheDocument();
  });

  it('shows AppearanceSection content by default', () => {
    const { getByText } = render(<SettingsRoute />);
    expect(getByText('Theme')).toBeInTheDocument();
  });

  it('switches to Git section when Git is clicked', async () => {
    const { getByText, findByText } = render(<SettingsRoute />);
    fireEvent.click(getByText('Git'));
    expect(await findByText('GitHub')).toBeInTheDocument();
  });

  it('navigates home on back link click', () => {
    const { getByLabelText } = render(<SettingsRoute />);
    fireEvent.click(getByLabelText('Back to app'));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: 'ws-1' },
    });
  });
});
