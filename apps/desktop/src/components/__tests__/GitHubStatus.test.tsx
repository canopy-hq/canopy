import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

let mockSettings: Array<{ key: string; value: string }> = [];

vi.mock('../../hooks/useCollections', () => ({ useSettings: () => mockSettings }));

vi.mock('@canopy/db', () => ({
  getSetting: (_settings: unknown[], key: string, fallback: unknown) => {
    const entry = mockSettings.find((s) => s.key === key);
    if (!entry) return fallback;
    try {
      return JSON.parse(entry.value);
    } catch {
      return fallback;
    }
  },
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../router', () => ({
  router: { navigate: vi.fn().mockResolvedValue(undefined), latestLocation: { pathname: '' } },
}));

import { GitHubStatus } from '../GitHubStatus';

describe('GitHubStatus', () => {
  afterEach(() => {
    cleanup();
    mockSettings = [];
  });

  it('renders GitHub icon when disconnected', () => {
    mockSettings = [];
    const { getByLabelText } = render(<GitHubStatus />);
    expect(getByLabelText('Connect GitHub')).toBeInTheDocument();
  });

  it('renders avatar when connected', () => {
    mockSettings = [
      {
        key: 'github:connection',
        value: JSON.stringify({ username: 'octocat', avatarUrl: 'https://example.com/avatar.png' }),
      },
    ];
    const { getByAltText } = render(<GitHubStatus />);
    expect(getByAltText('octocat')).toBeInTheDocument();
  });
});
