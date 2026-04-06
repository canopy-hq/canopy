import { useState, useRef, useEffect, useMemo } from 'react';

import { getSettingCollection, getSetting, getProjectCollection, setSetting } from '@superagent/db';

import { pollAllProjectStates } from '../lib/git';
import { getExpandedProjectPaths } from '../lib/project-utils';

import type { DiffStat, ProjectPollState } from '../lib/git';
import type { Project } from '@superagent/db';

type StatsMap = Record<string, Record<string, DiffStat>>;

const DIFF_STATS_SETTING_KEY = 'diffStatsMap';

function loadCachedStatsMap(): StatsMap {
  const settings = getSettingCollection().toArray;
  return getSetting<StatsMap>(settings, DIFF_STATS_SETTING_KEY, {});
}

const POLL_MS = 3_000;

export function getInterval(noChangeCount: number): number {
  if (noChangeCount >= 10) return 15_000;
  if (noChangeCount >= 5) return 10_000;
  return POLL_MS;
}

/** Shallow-compare two nested diff stats maps. */
function statsEqual(
  a: Record<string, Record<string, DiffStat>>,
  b: Record<string, Record<string, DiffStat>>,
): boolean {
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

/** Compare two single-project poll states. */
function projectStateEqual(a: ProjectPollState, b: ProjectPollState): boolean {
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
function findChangedProjects(
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

/**
 * Combined project polling hook: fetches diff stats + branch state in a single IPC call.
 * Returns diff stats map (same as former useDiffStatsMap).
 * Side-effect: updates project collection branches when changes are detected.
 */
export function useProjectPolling(
  projects: Project[],
  enabled: boolean,
  resetKey?: string,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<StatsMap>(loadCachedStatsMap);
  const projectsRef = useRef(projects);
  const noChangeCountRef = useRef(0);
  const prevStatsRef = useRef(statsMap);
  const prevBranchStateRef = useRef<Record<string, ProjectPollState>>({});
  prevStatsRef.current = statsMap;

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const projectKey = useMemo(
    () =>
      projects.map((p) => `${p.id}:${p.expanded ? 1 : 0}`).join(',') +
      (resetKey != null ? `|${resetKey}` : ''),
    [projects, resetKey],
  );

  useEffect(() => {
    if (!enabled) return;
    noChangeCountRef.current = 0;
    prevBranchStateRef.current = {};

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = projectsRef.current;
      const { paths, pathToId, expandedIds } = getExpandedProjectPaths(current);
      if (paths.length === 0) {
        timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        return;
      }

      pollAllProjectStates(paths)
        .then(async (result) => {
          if (cancelled) return;

          // --- Diff stats ---
          const nextStats: Record<string, Record<string, DiffStat>> = {};
          for (const [path, state] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) nextStats[id] = state.diff_stats;
          }

          const prevStats = prevStatsRef.current;
          const mergedStats: Record<string, Record<string, DiffStat>> = {};
          for (const projId in prevStats) {
            if (!expandedIds.has(projId)) mergedStats[projId] = prevStats[projId]!;
          }
          for (const projId in nextStats) {
            mergedStats[projId] = nextStats[projId]!;
          }

          const diffStatsChanged = !statsEqual(prevStats, mergedStats);

          // --- Branch state ---
          const nextBranchState: Record<string, ProjectPollState> = {};
          for (const [path, state] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) nextBranchState[id] = state;
          }

          const prevBranch = prevBranchStateRef.current;
          const mergedBranch: Record<string, ProjectPollState> = {};
          for (const projId in prevBranch) {
            if (!expandedIds.has(projId)) mergedBranch[projId] = prevBranch[projId]!;
          }
          for (const projId in nextBranchState) {
            mergedBranch[projId] = nextBranchState[projId]!;
          }

          const changedProjIds = findChangedProjects(prevBranch, mergedBranch);
          const branchChanged = changedProjIds.length > 0;

          // Update branch data for changed projects
          if (branchChanged) {
            const collection = getProjectCollection();
            for (const projId of changedProjIds) {
              const state = mergedBranch[projId];
              if (!state) continue;
              const head = state.branches.find((b) => b.is_head);
              collection.update(projId, (draft) => {
                // Replace branches with just the current HEAD
                if (head) {
                  draft.branches = [head];
                }
                // Update worktree branch names on existing entries only (preserve list + labels)
                const wtBranches = state.worktree_branches;
                for (const wt of draft.worktrees) {
                  const newBranch = wtBranches[wt.name];
                  if (newBranch !== undefined) {
                    wt.branch = newBranch;
                  }
                }
              });
            }
          }

          prevBranchStateRef.current = mergedBranch;

          if (diffStatsChanged || branchChanged) {
            noChangeCountRef.current = 0;
            if (diffStatsChanged) {
              setStatsMap(mergedStats);
              setSetting(DIFF_STATS_SETTING_KEY, mergedStats);
            }
          } else {
            noChangeCountRef.current += 1;
          }

          timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        });
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectKey, enabled]);

  return statsMap;
}
