import type { Workspace } from '@superagent/db';

export interface ExpandedWorkspaceInfo {
  paths: string[];
  pathToId: Map<string, string>;
  expandedIds: Set<string>;
}

export function getExpandedWorkspacePaths(workspaces: Workspace[]): ExpandedWorkspaceInfo {
  const expanded = workspaces.filter((ws) => ws.expanded);
  return {
    paths: expanded.map((ws) => ws.path),
    pathToId: new Map(expanded.map((ws) => [ws.path, ws.id])),
    expandedIds: new Set(expanded.map((ws) => ws.id)),
  };
}
