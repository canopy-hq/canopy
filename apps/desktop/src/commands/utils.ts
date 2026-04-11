import type { Tab, Project } from '@canopy/db';

/** Find the project that owns a given projectItemId (branch/worktree/root). */
export function resolveProject(projectItemId: string, projects: Project[]): Project | undefined {
  return projects.find((p) => projectItemId.startsWith(p.id));
}

/** Find the project that owns a given tab. */
export function resolveProjectForTab(tab: Tab, projects: Project[]): Project | undefined {
  return resolveProject(tab.projectItemId, projects);
}
