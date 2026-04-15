import { useState, useRef, useEffect, useMemo } from 'react';

import {
  getSettingCollection,
  getSetting,
  getProjectCollection,
  getUiState,
  setSetting,
  uiCollection,
} from '@canopy/db';

import { pollAllProjectStates } from '../lib/git';
import { logInfo } from '../lib/log';
import { hideWorktree } from '../lib/project-actions';
import {
  getExpandedProjectPaths,
  statsEqual,
  findChangedProjects,
  getStaleWorktreeNames,
} from '../lib/project-utils';

import type { DiffStat, ProjectPollState } from '../lib/git';
import type { StatsMap } from '../lib/project-utils';
import type { Project } from '@canopy/db';

// Re-export for backwards compat (tests import from here)
export { getStaleWorktreeNames, branchStateEqual } from '../lib/project-utils';

const DIFF_STATS_SETTING_KEY = 'diffStatsMap';

function loadCachedStatsMap(): StatsMap {
  const settings = getSettingCollection().toArray;
  return getSetting<StatsMap>(settings, DIFF_STATS_SETTING_KEY, {});
}

const POLL_MS = 3_000;
const MISS_THRESHOLD = 2;
/** Debounce delay for resetKey — prevents rapid project switches from firing
 * multiple concurrent pollAllProjectStates calls. */
const RESET_KEY_DEBOUNCE_MS = 300;

export function getInterval(noChangeCount: number): number {
  if (noChangeCount >= 10) return 15_000;
  if (noChangeCount >= 5) return 10_000;
  return POLL_MS;
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
  // Track consecutive poll misses per project ID to detect deleted directories
  const missCountRef = useRef<Record<string, number>>({});
  prevStatsRef.current = statsMap;

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Debounce resetKey so rapid project switches don't fire multiple concurrent polls.
  const [debouncedResetKey, setDebouncedResetKey] = useState(resetKey);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedResetKey(resetKey), RESET_KEY_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [resetKey]);

  const projectKey = useMemo(
    () =>
      projects.map((p) => `${p.id}:${p.expanded ? 1 : 0}`).join(',') +
      (debouncedResetKey != null ? `|${debouncedResetKey}` : ''),
    [projects, debouncedResetKey],
  );

  useEffect(() => {
    if (!enabled) return;
    noChangeCountRef.current = 0;
    prevBranchStateRef.current = {};
    // Pre-fill miss counts so the very first failed poll immediately triggers invalid
    const { expandedIds: initialIds } = getExpandedProjectPaths(projectsRef.current);
    const initialMisses: Record<string, number> = {};
    for (const id of initialIds) initialMisses[id] = MISS_THRESHOLD - 1;
    missCountRef.current = initialMisses;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = projectsRef.current;

      // Prune miss counts for projects that no longer exist
      const currentIds = new Set(current.map((p) => p.id));
      for (const id in missCountRef.current) {
        if (!currentIds.has(id)) delete missCountRef.current[id];
      }

      const cloningIds = new Set(getUiState().cloningProjectIds);
      const { paths, pathToId, expandedIds } = getExpandedProjectPaths(
        cloningIds.size > 0 ? current.filter((p) => !cloningIds.has(p.id)) : current,
      );
      if (paths.length === 0) {
        timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        return;
      }

      pollAllProjectStates(paths)
        .then(async (result) => {
          if (cancelled) return;

          const invalidIds = new Set(getUiState().invalidProjectIds);

          // --- Diff stats ---
          const nextStats: Record<string, Record<string, DiffStat>> = {};
          for (const [path, state] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) nextStats[id] = state.diff_stats;
          }

          const prevStats = prevStatsRef.current;
          const mergedStats: Record<string, Record<string, DiffStat>> = {};
          for (const projId in prevStats) {
            if (!expandedIds.has(projId) || invalidIds.has(projId)) {
              mergedStats[projId] = prevStats[projId]!;
            }
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
            // Preserve state for: collapsed projects + invalid projects (frozen data)
            if (!expandedIds.has(projId) || invalidIds.has(projId)) {
              mergedBranch[projId] = prevBranch[projId]!;
            }
          }
          for (const projId in nextBranchState) {
            mergedBranch[projId] = nextBranchState[projId]!;
          }

          const changedProjIds = findChangedProjects(prevBranch, mergedBranch);
          const branchChanged = changedProjIds.length > 0;

          // Update branch data for changed projects
          if (branchChanged) {
            const collection = getProjectCollection();
            const creatingIds = getUiState().creatingWorktreeIds;
            for (const projId of changedProjIds) {
              const state = mergedBranch[projId];
              if (!state) continue;

              // Prune worktrees that no longer exist in git
              const proj = collection.toArray.find((p) => p.id === projId);
              if (proj) {
                const stale = getStaleWorktreeNames(
                  proj.worktrees,
                  state.worktree_branches,
                  creatingIds,
                  projId,
                );
                for (const name of stale) {
                  logInfo(`[poll] pruning stale worktree "${name}" from project "${proj.name}"`);
                  hideWorktree(projId, name);
                }
              }

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

          // --- Invalid project detection ---
          // A project is "invalid" when its path consistently fails to poll
          // (directory deleted, unmounted drive, etc.)
          const misses = missCountRef.current;
          let invalidChanged = false;
          for (const projId of expandedIds) {
            if (nextBranchState[projId]) {
              // Path polled successfully → reset miss count and clear invalid if set
              if (misses[projId]) {
                delete misses[projId];
                invalidChanged = true;
              }
            } else {
              misses[projId] = (misses[projId] ?? 0) + 1;
              if (misses[projId] === MISS_THRESHOLD) invalidChanged = true;
            }
          }
          if (invalidChanged) {
            const nowInvalidIds = new Set(
              Object.entries(misses)
                .filter(([, count]) => count >= MISS_THRESHOLD)
                .map(([id]) => id),
            );
            uiCollection.update('ui', (draft) => {
              draft.invalidProjectIds = [...nowInvalidIds];
            });
            // Persist invalid flag to DB so state survives app reload
            const collection = getProjectCollection();
            const allProjects = collection.toArray;
            for (const proj of allProjects) {
              if (!expandedIds.has(proj.id)) continue;
              const shouldBeInvalid = nowInvalidIds.has(proj.id);
              if (proj.invalid !== shouldBeInvalid) {
                collection.update(proj.id, (draft) => {
                  draft.invalid = shouldBeInvalid;
                });
              }
            }
          }

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
