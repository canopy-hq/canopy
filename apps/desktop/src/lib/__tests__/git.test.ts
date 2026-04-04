import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSetting = vi.fn();
const mockGetSettingCollection = vi.fn();

vi.mock('@superagent/db', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettingCollection: () => mockGetSettingCollection(),
}));

import { buildWorktreePath } from '../git';

describe('buildWorktreePath', () => {
  beforeEach(() => {
    mockGetSetting.mockReset();
    mockGetSettingCollection.mockReset();
    mockGetSettingCollection.mockReturnValue({ toArray: [] });
  });

  it('returns default path when no custom dir is set', () => {
    mockGetSetting.mockReturnValue('~/.superagent/worktrees');
    expect(buildWorktreePath('my-repo', 'feat-x')).toBe('~/.superagent/worktrees/my-repo-feat-x');
  });

  it('returns custom path when setting is configured', () => {
    mockGetSetting.mockReturnValue('/Users/me/worktrees');
    expect(buildWorktreePath('my-repo', 'feat-x')).toBe('/Users/me/worktrees/my-repo-feat-x');
  });
});
