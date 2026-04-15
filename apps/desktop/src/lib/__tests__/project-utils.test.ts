import { describe, it, expect } from 'vitest';

import { getExpandedProjectPaths, branchStateEqual, getStaleWorktreeNames } from '../project-utils';

import type { ProjectPollState } from '../git';
import type { Project } from '@canopy/db';

function makeProject(id: string, path: string, expanded: boolean): Project {
  return { id, path, name: id, expanded, position: 0, branches: [], worktrees: [], invalid: false };
}

describe('getExpandedProjectPaths', () => {
  it('returns only expanded projects', () => {
    const projects = [
      makeProject('proj1', '/path/1', true),
      makeProject('proj2', '/path/2', false),
      makeProject('proj3', '/path/3', true),
    ];
    const result = getExpandedProjectPaths(projects);
    expect(result.paths).toEqual(['/path/1', '/path/3']);
    expect(result.expandedIds.size).toBe(2);
    expect(result.expandedIds.has('proj1')).toBe(true);
    expect(result.expandedIds.has('proj3')).toBe(true);
  });

  it('maps paths to IDs correctly', () => {
    const projects = [makeProject('proj1', '/path/1', true)];
    const result = getExpandedProjectPaths(projects);
    expect(result.pathToId.get('/path/1')).toBe('proj1');
  });

  it('returns empty for no expanded projects', () => {
    const projects = [makeProject('proj1', '/path/1', false)];
    const result = getExpandedProjectPaths(projects);
    expect(result.paths).toEqual([]);
    expect(result.pathToId.size).toBe(0);
    expect(result.expandedIds.size).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = getExpandedProjectPaths([]);
    expect(result.paths).toEqual([]);
  });
});

// ── branchStateEqual ───────────────────────────────────────────────────

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

// ── getStaleWorktreeNames ──────────────────────────────────────────────

describe('getStaleWorktreeNames', () => {
  it('returns names of worktrees missing from live git state', () => {
    const db = [{ name: 'wt-a' }, { name: 'wt-b' }, { name: 'wt-c' }];
    const live = { 'wt-a': 'main', 'wt-c': 'feature' };
    expect(getStaleWorktreeNames(db, live, [], 'proj1')).toEqual(['wt-b']);
  });

  it('returns empty when all worktrees are live', () => {
    const db = [{ name: 'wt-a' }, { name: 'wt-b' }];
    const live = { 'wt-a': 'main', 'wt-b': 'feature' };
    expect(getStaleWorktreeNames(db, live, [], 'proj1')).toEqual([]);
  });

  it('skips worktrees that are being created (in-flight)', () => {
    const db = [{ name: 'wt-new' }];
    const live = {};
    const creating = ['proj1-wt-wt-new'];
    expect(getStaleWorktreeNames(db, live, creating, 'proj1')).toEqual([]);
  });

  it('returns all names when no live worktrees exist', () => {
    const db = [{ name: 'wt-a' }, { name: 'wt-b' }];
    expect(getStaleWorktreeNames(db, {}, [], 'proj1')).toEqual(['wt-a', 'wt-b']);
  });

  it('returns empty for empty DB worktrees', () => {
    expect(getStaleWorktreeNames([], { 'wt-a': 'main' }, [], 'proj1')).toEqual([]);
  });
});
