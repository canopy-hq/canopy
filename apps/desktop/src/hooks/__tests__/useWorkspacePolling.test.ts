import { describe, it, expect } from 'vitest';

import { getInterval, branchStateEqual, mergeBranches } from '../useWorkspacePolling';

import type { BranchInfo, WorkspacePollState } from '../../lib/git';

function makeState(overrides: Partial<WorkspacePollState> = {}): WorkspacePollState {
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
    const a = { ws1: makeState() };
    const b = { ws1: makeState() };
    expect(branchStateEqual(a, b)).toBe(true);
  });

  it('returns false when head_oid differs', () => {
    const a = { ws1: makeState({ head_oid: 'abc' }) };
    const b = { ws1: makeState({ head_oid: 'def' }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when a branch is added', () => {
    const a = { ws1: makeState() };
    const b = {
      ws1: makeState({
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
    const a = { ws1: makeState() };
    const b = {
      ws1: makeState({ branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }] }),
    };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when is_head changes', () => {
    const a = { ws1: makeState() };
    const b = {
      ws1: makeState({
        branches: [
          { name: 'main', is_head: false, ahead: 0, behind: 0 },
          { name: 'feature', is_head: true, ahead: 0, behind: 0 },
        ],
      }),
    };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when worktree branch changes', () => {
    const a = { ws1: makeState({ worktree_branches: { wt1: 'main' } }) };
    const b = { ws1: makeState({ worktree_branches: { wt1: 'feature' } }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when worktree is added', () => {
    const a = { ws1: makeState({ worktree_branches: {} }) };
    const b = { ws1: makeState({ worktree_branches: { wt1: 'main' } }) };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when workspace count differs', () => {
    const a = { ws1: makeState() };
    const b = { ws1: makeState(), ws2: makeState() };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('returns false when workspace is missing', () => {
    const a = { ws1: makeState() };
    const b = { ws2: makeState() };
    expect(branchStateEqual(a, b)).toBe(false);
  });

  it('ignores ahead/behind differences (lightweight poll)', () => {
    const a = { ws1: makeState() };
    const b = {
      ws1: makeState({
        branches: [
          { name: 'main', is_head: true, ahead: 5, behind: 3 },
          { name: 'feature', is_head: false, ahead: 1, behind: 0 },
        ],
      }),
    };
    expect(branchStateEqual(a, b)).toBe(true);
  });
});

function makeBranch(name: string, is_head = false): BranchInfo {
  return { name, is_head, ahead: 0, behind: 0 };
}

describe('mergeBranches', () => {
  it('updates is_head in place without replacing objects', () => {
    const main = makeBranch('main', true);
    const feature = makeBranch('feature', false);
    const draft = [main, feature];

    mergeBranches(draft, [makeBranch('main', false), makeBranch('feature', true)]);

    // Same object references — mutated in place
    expect(draft[0]).toBe(main);
    expect(draft[1]).toBe(feature);
    // Values updated
    expect(draft[0].is_head).toBe(false);
    expect(draft[1].is_head).toBe(true);
  });

  it('updates ahead/behind in place', () => {
    const draft = [makeBranch('main', true)];
    mergeBranches(draft, [{ name: 'main', is_head: true, ahead: 3, behind: 1 }]);
    expect(draft[0].ahead).toBe(3);
    expect(draft[0].behind).toBe(1);
  });

  it('appends new branches', () => {
    const draft = [makeBranch('main', true)];
    mergeBranches(draft, [makeBranch('main', true), makeBranch('feature', false)]);
    expect(draft).toHaveLength(2);
    expect(draft[1].name).toBe('feature');
  });

  it('removes deleted branches', () => {
    const draft = [makeBranch('main', true), makeBranch('old', false)];
    mergeBranches(draft, [makeBranch('main', true)]);
    expect(draft).toHaveLength(1);
    expect(draft[0].name).toBe('main');
  });

  it('handles simultaneous add and remove', () => {
    const draft = [makeBranch('main', true), makeBranch('old', false)];
    mergeBranches(draft, [makeBranch('main', true), makeBranch('new', false)]);
    expect(draft).toHaveLength(2);
    expect(draft.map((b) => b.name)).toEqual(['main', 'new']);
  });
});
