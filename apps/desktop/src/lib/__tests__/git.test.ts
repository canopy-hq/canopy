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
    mockGetSetting.mockReturnValue('~/.superagent/worktrees');
  });

  it('prefixes the leaf with the project directory basename', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'my-feature')).toBe(
      '~/.superagent/worktrees/mon-projet.my-feature',
    );
  });

  it('puts the directory portion of the wt name before the prefixed leaf', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'feat/my-feature')).toBe(
      '~/.superagent/worktrees/feat/mon-projet.my-feature',
    );
  });

  it('handles nested wt name directories', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'team/feat/my-feature')).toBe(
      '~/.superagent/worktrees/team/feat/mon-projet.my-feature',
    );
  });

  it('uses the custom base dir when configured', () => {
    mockGetSetting.mockReturnValue('/Users/me/worktrees');
    expect(buildWorktreePath('/repos/mon-projet', 'feat/my-feature')).toBe(
      '/Users/me/worktrees/feat/mon-projet.my-feature',
    );
  });

  it('strips trailing slash from project path', () => {
    expect(buildWorktreePath('/repos/mon-projet/', 'my-feature')).toBe(
      '~/.superagent/worktrees/mon-projet.my-feature',
    );
  });
});
