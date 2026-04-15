import type { DiffStat, ProjectPollState } from './git';
import type { Project } from '@canopy/db';

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

// ── Diff stats comparison ──────────────────────────────────────────────

export type StatsMap = Record<string, Record<string, DiffStat>>;

/** Shallow-compare two nested diff stats maps. */
export function statsEqual(a: StatsMap, b: StatsMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const projId of bKeys) {
    const aProj = a[projId];
    const bProj = b[projId];
    if (!aProj || !bProj) return false;
    const aK = Object.keys(aProj);
    const bK = Object.keys(bProj);
    if (aK.length !== bK.length) return false;
    for (const k of bK) {
      if (
        aProj[k]?.additions !== bProj[k]?.additions ||
        aProj[k]?.deletions !== bProj[k]?.deletions
      )
        return false;
    }
  }
  return true;
}

// ── Branch state comparison ────────────────────────────────────────────

/** Compare two single-project poll states (ignores ahead/behind). */
export function projectStateEqual(a: ProjectPollState, b: ProjectPollState): boolean {
  if (a.head_oid !== b.head_oid) return false;
  if (a.branches.length !== b.branches.length) return false;
  for (let i = 0; i < b.branches.length; i++) {
    if (a.branches[i]!.name !== b.branches[i]!.name) return false;
    if (a.branches[i]!.is_head !== b.branches[i]!.is_head) return false;
  }
  const aWtKeys = Object.keys(a.worktree_branches);
  const bWtKeys = Object.keys(b.worktree_branches);
  if (aWtKeys.length !== bWtKeys.length) return false;
  for (const wt of bWtKeys) {
    if (a.worktree_branches[wt] !== b.worktree_branches[wt]) return false;
  }
  return true;
}

/** Identify which project IDs have changed branch state. */
export function findChangedProjects(
  prev: Record<string, ProjectPollState>,
  next: Record<string, ProjectPollState>,
): string[] {
  return Object.keys(next).filter((projId) => {
    const a = prev[projId];
    const b = next[projId];
    if (!a || !b) return true;
    return !projectStateEqual(a, b);
  });
}

/** Compare branch poll states for change detection across projects. */
export function branchStateEqual(
  a: Record<string, ProjectPollState>,
  b: Record<string, ProjectPollState>,
): boolean {
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  return findChangedProjects(a, b).length === 0;
}

/** Return names of DB worktrees that no longer exist in git (excluding in-flight creations). */
export function getStaleWorktreeNames(
  dbWorktrees: { name: string }[],
  liveWorktreeBranches: Record<string, string>,
  creatingWtIds: string[],
  projId: string,
): string[] {
  return dbWorktrees
    .filter((wt) => {
      if (liveWorktreeBranches[wt.name] !== undefined) return false;
      if (creatingWtIds.includes(`${projId}-wt-${wt.name}`)) return false;
      return true;
    })
    .map((wt) => wt.name);
}
