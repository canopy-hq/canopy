import type { Project } from '@superagent/db';

export interface ExpandedProjectInfo {
  paths: string[];
  pathToId: Map<string, string>;
  expandedIds: Set<string>;
}

export function getExpandedProjectPaths(projects: Project[]): ExpandedProjectInfo {
  const expanded = projects.filter((p) => p.expanded);
  return {
    paths: expanded.map((p) => p.path),
    pathToId: new Map(expanded.map((p) => [p.path, p.id])),
    expandedIds: new Set(expanded.map((p) => p.id)),
  };
}
