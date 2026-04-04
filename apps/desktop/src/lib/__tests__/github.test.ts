import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import { startDeviceFlow, pollToken, getConnection, disconnect } from '../github';

describe('github', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('startDeviceFlow calls invoke with correct command', async () => {
    const response = {
      deviceCode: 'abc123',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    };
    mockInvoke.mockResolvedValue(response);

    const result = await startDeviceFlow();
    expect(mockInvoke).toHaveBeenCalledWith('github_start_device_flow');
    expect(result).toEqual(response);
  });

  it('pollToken passes deviceCode, interval and expiresIn', async () => {
    const connection = { username: 'octocat', avatarUrl: 'https://example.com/avatar.png' };
    mockInvoke.mockResolvedValue(connection);

    const result = await pollToken('abc123', 5, 900);
    expect(mockInvoke).toHaveBeenCalledWith('github_poll_token', {
      deviceCode: 'abc123',
      interval: 5,
      expiresIn: 900,
    });
    expect(result).toEqual(connection);
  });

  it('getConnection returns null when not connected', async () => {
    mockInvoke.mockResolvedValue(null);

    const result = await getConnection();
    expect(mockInvoke).toHaveBeenCalledWith('github_get_connection');
    expect(result).toBeNull();
  });

  it('disconnect calls the correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await disconnect();
    expect(mockInvoke).toHaveBeenCalledWith('github_disconnect');
  });
});
