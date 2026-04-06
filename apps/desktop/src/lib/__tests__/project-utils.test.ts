import { describe, it, expect } from 'vitest';

import { getExpandedProjectPaths } from '../project-utils';

import type { Project } from '@superagent/db';

function makeProject(id: string, path: string, expanded: boolean): Project {
  return { id, path, name: id, expanded, position: 0, branches: [], worktrees: [] } as Project;
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
