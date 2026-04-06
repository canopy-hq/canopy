import { describe, it, expect } from 'vitest';

import { getInterval, branchStateEqual } from '../useProjectPolling';

import type { ProjectPollState } from '../../lib/git';

function makeState(overrides: Partial<ProjectPollState> = {}): ProjectPollState {
  return {
    head_oid: 'abc123',
    branches: [
      { name: 'main', is_head: true, ahead: 0, behind: 0 },
      { name: 'feature', is_head: false, ahead: 0, behind: 0 },
    ],
    worktree_branches: {},
    diff_stats: {},
    ...overrides,
  };
}

describe('getInterval', () => {
  it('returns 3s for 0 unchanged polls', () => {
    expect(getInterval(0)).toBe(3_000);
  });

  it('returns 3s for 4 unchanged polls', () => {
    expect(getInterval(4)).toBe(3_000);
  });

  it('returns 10s at 5 unchanged polls', () => {
    expect(getInterval(5)).toBe(10_000);
  });

  it('returns 10s at 9 unchanged polls', () => {
    expect(getInterval(9)).toBe(10_000);
  });

  it('returns 15s at 10 unchanged polls', () => {
    expect(getInterval(10)).toBe(15_000);
  });

  it('returns 15s at 20 unchanged polls', () => {
    expect(getInterval(20)).toBe(15_000);
  });
});

describe('branchStateEqual', () => {
  it('returns true for identical states', () => {
    const a = { proj1: makeState() };
    const b = { proj1: makeState() };
    expect(branchStateEqual(a, b)).toBe(true);
  });

  it('returns false when head_oid differs', () => {
    const a = { proj1: makeState({ head_oid: 'abc' }) };
    const b = { proj1: makeState({ head_oid: 'def' }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when a branch is added', () => {
    const a = { proj1: makeState() };
    const b = {
      proj1: makeState({
        branches: [
          { name: 'main', is_head: true, ahead: 0, behind: 0 },
          { name: 'feature', is_head: false, ahead: 0, behind: 0 },
          { name: 'hotfix', is_head: false, ahead: 0, behind: 0 },
        ],
      }),
    };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when a branch is removed', () => {
    const a = { proj1: makeState() };
    const b = {
      proj1: makeState({ branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }] }),
    };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when is_head changes', () => {
    const a = { proj1: makeState() };
    const b = {
      proj1: makeState({
        branches: [
          { name: 'main', is_head: false, ahead: 0, behind: 0 },
          { name: 'feature', is_head: true, ahead: 0, behind: 0 },
        ],
      }),
    };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when worktree branch changes', () => {
    const a = { proj1: makeState({ worktree_branches: { wt1: 'main' } }) };
    const b = { proj1: makeState({ worktree_branches: { wt1: 'feature' } }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when worktree is added', () => {
    const a = { proj1: makeState({ worktree_branches: {} }) };
    const b = { proj1: makeState({ worktree_branches: { wt1: 'main' } }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when project count differs', () => {
    const a = { proj1: makeState() };
    const b = { proj1: makeState(), proj2: makeState() };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when project is missing', () => {
    const a = { proj1: makeState() };
    const b = { proj2: makeState() };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('ignores ahead/behind differences (lightweight poll)', () => {
    const a = { proj1: makeState() };
    const b = {
      proj1: makeState({
        branches: [
          { name: 'main', is_head: true, ahead: 5, behind: 3 },
          { name: 'feature', is_head: false, ahead: 1, behind: 0 },
        ],
      }),
    };
    expect(branchStateEqual(a, b)).toBe(true);
  });
});
