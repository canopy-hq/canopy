import { describe, it, expect } from 'vitest';

import { getExpandedWorkspacePaths } from '../workspace-utils';

import type { Workspace } from '@superagent/db';

function makeWs(id: string, path: string, expanded: boolean): Workspace {
  return { id, path, name: id, expanded, position: 0, branches: [], worktrees: [] } as Workspace;
}

describe('getExpandedWorkspacePaths', () => {
  it('returns only expanded workspaces', () => {
    const workspaces = [
      makeWs('ws1', '/path/1', true),
      makeWs('ws2', '/path/2', false),
      makeWs('ws3', '/path/3', true),
    ];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.paths).toEqual(['/path/1', '/path/3']);
    expect(result.expandedIds.size).toBe(2);
    expect(result.expandedIds.has('ws1')).toBe(true);
    expect(result.expandedIds.has('ws3')).toBe(true);
  });

  it('maps paths to IDs correctly', () => {
    const workspaces = [makeWs('ws1', '/path/1', true)];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.pathToId.get('/path/1')).toBe('ws1');
  });

  it('returns empty for no expanded workspaces', () => {
    const workspaces = [makeWs('ws1', '/path/1', false)];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.paths).toEqual([]);
    expect(result.pathToId.size).toBe(0);
    expect(result.expandedIds.size).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = getExpandedWorkspacePaths([]);
    expect(result.paths).toEqual([]);
  });
});
