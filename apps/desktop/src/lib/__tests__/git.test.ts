import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSetting = vi.fn();
const mockGetSettingCollection = vi.fn();

vi.mock('@canopy/db', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettingCollection: () => mockGetSettingCollection(),
}));

import { sanitizeWorktreeName, worktreeAdminName, buildWorktreePath } from '../git';

describe('sanitizeWorktreeName', () => {
  it('replaces spaces with dashes', () => {
    expect(sanitizeWorktreeName('my feature')).toBe('my-feature');
  });

  it('replaces underscores with dashes', () => {
    expect(sanitizeWorktreeName('my_feature')).toBe('my-feature');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeWorktreeName('  my-feature  ')).toBe('my-feature');
  });

  it('preserves internal slashes (used as subdirectory separators by buildWorktreePath)', () => {
    expect(sanitizeWorktreeName('feature/my-fix')).toBe('feature/my-fix');
  });

  it('strips leading and trailing slashes', () => {
    expect(sanitizeWorktreeName('/feature/my-fix/')).toBe('feature/my-fix');
  });

  it('collapses multiple consecutive slashes to one', () => {
    expect(sanitizeWorktreeName('feature//my-fix')).toBe('feature/my-fix');
  });
});

describe('worktreeAdminName', () => {
  it('is a no-op when the name has no slashes', () => {
    expect(worktreeAdminName('my-feature')).toBe('my-feature');
  });

  it('replaces a single slash with a dash', () => {
    expect(worktreeAdminName('feature/my-fix')).toBe('feature-my-fix');
  });

  it('replaces all slashes in a deeply nested name', () => {
    expect(worktreeAdminName('team/feat/my-fix')).toBe('team-feat-my-fix');
  });

  it('roundtrip: sanitizeWorktreeName → worktreeAdminName never contains slashes', () => {
    const inputs = ['feature/foo', 'a/b/c', 'simple', 'with spaces', 'team/feat/bar', '/leading/'];
    for (const input of inputs) {
      expect(worktreeAdminName(sanitizeWorktreeName(input))).not.toContain('/');
    }
  });

  it('matches simple names produced by sanitizeWorktreeName unchanged', () => {
    // For names without slashes, the two functions commute: order doesn't matter
    expect(worktreeAdminName(sanitizeWorktreeName('my feature'))).toBe('my-feature');
  });
});

describe('buildWorktreePath', () => {
  beforeEach(() => {
    mockGetSetting.mockReset();
    mockGetSettingCollection.mockReset();
    mockGetSettingCollection.mockReturnValue({ toArray: [] });
    mockGetSetting.mockReturnValue('~/.canopy/worktrees');
  });

  it('prefixes the leaf with the project directory basename', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'my-feature')).toBe(
      '~/.canopy/worktrees/mon-projet.my-feature',
    );
  });

  it('puts the directory portion of the wt name before the prefixed leaf', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'feat/my-feature')).toBe(
      '~/.canopy/worktrees/feat/mon-projet.my-feature',
    );
  });

  it('handles nested wt name directories', () => {
    expect(buildWorktreePath('/repos/mon-projet', 'team/feat/my-feature')).toBe(
      '~/.canopy/worktrees/team/feat/mon-projet.my-feature',
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
      '~/.canopy/worktrees/mon-projet.my-feature',
    );
  });
});
