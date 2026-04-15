import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import {
  getSettingCollection,
  getSetting,
  getProjectCollection,
  getUiState,
  setSetting,
  uiCollection,
} from '@canopy/db';

import {
  pollAllProjectStates,
  startProjectWatcher,
  stopProjectWatcher,
  pauseWatchers,
  resumeWatchers,
} from '../lib/git';
import { logInfo } from '../lib/log';
import { hideWorktree } from '../lib/project-actions';
import {
  getExpandedProjectPaths,
  projectStateEqual,
  getStaleWorktreeNames,
} from '../lib/project-utils';

import type { DiffStat, ProjectPollState, ProjectStateChangedEvent } from '../lib/git';
import type { StatsMap } from '../lib/project-utils';
import type { Project } from '@canopy/db';

const DIFF_STATS_SETTING_KEY = 'diffStatsMap';
const FALLBACK_POLL_MS = 30_000;
const MISS_THRESHOLD = 2;

function loadCachedStatsMap(): StatsMap {
  const settings = getSettingCollection().toArray;
  return getSetting<StatsMap>(settings, DIFF_STATS_SETTING_KEY, {});
}

/**
 * FS-watcher-based project state hook. Replaces polling with near-instant
 * updates via `notify` (FSEvents on macOS). Falls back to a 30s poll as
 * safety net.
 *
 * Returns the same `Record<projectId, Record<branchName, DiffStat>>` shape
 * as the former `useProjectPolling`.
 */
export function useProjectWatcher(
  projects: Project[],
  enabled: boolean,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<StatsMap>(loadCachedStatsMap);
  const projectsRef = useRef(projects);
  const prevStatsRef = useRef(statsMap);
  const prevBranchStateRef = useRef<Record<string, ProjectPollState>>({});
  const missCountRef = useRef<Record<string, number>>({});
  const activeWatchersRef = useRef(new Set<string>());
  prevStatsRef.current = statsMap;

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // ── Process a single project state update ──

  const processStateUpdate = useCallback((projId: string, state: ProjectPollState) => {
    // --- Diff stats ---
    const prevStats = prevStatsRef.current;
    const prevProjectStats = prevStats[projId];
    const nextProjectStats = state.diff_stats;

    // Quick check: did this project's diff stats actually change?
    let diffStatsChanged = false;
    if (!prevProjectStats) {
      diffStatsChanged = Object.keys(nextProjectStats).length > 0;
    } else {
      const prevKeys = Object.keys(prevProjectStats);
      const nextKeys = Object.keys(nextProjectStats);
      if (prevKeys.length !== nextKeys.length) {
        diffStatsChanged = true;
      } else {
        for (const k of nextKeys) {
          if (
            prevProjectStats[k]?.additions !== nextProjectStats[k]?.additions ||
            prevProjectStats[k]?.deletions !== nextProjectStats[k]?.deletions
          ) {
            diffStatsChanged = true;
            break;
          }
        }
      }
    }

    // --- Branch state ---
    const prevBranch = prevBranchStateRef.current;
    const prevProjState = prevBranch[projId];
    const branchChanged = !prevProjState || !projectStateEqual(prevProjState, state);

    if (branchChanged) {
      prevBranchStateRef.current = { ...prevBranch, [projId]: state };

      const collection = getProjectCollection();
      const creatingIds = getUiState().creatingWorktreeIds;
      const proj = collection.toArray.find((p) => p.id === projId);
      if (proj) {
        const stale = getStaleWorktreeNames(
          proj.worktrees,
          state.worktree_branches,
          creatingIds,
          projId,
        );
        for (const name of stale) {
          logInfo(`[watcher] pruning stale worktree "${name}" from project "${proj.name}"`);
          hideWorktree(projId, name);
        }
      }

      const head = state.branches.find((b) => b.is_head);
      collection.update(projId, (draft) => {
        if (head) {
          draft.branches = [head];
        }
        const wtBranches = state.worktree_branches;
        for (const wt of draft.worktrees) {
          const newBranch = wtBranches[wt.name];
          if (newBranch !== undefined) {
            wt.branch = newBranch;
          }
        }
      });
    }

    // --- Clear invalid flag on successful state ---
    const misses = missCountRef.current;
    if (misses[projId]) {
      delete misses[projId];
      const nowInvalidIds = new Set(
        Object.entries(misses)
          .filter(([, count]) => count >= MISS_THRESHOLD)
          .map(([id]) => id),
      );
      uiCollection.update('ui', (draft) => {
        draft.invalidProjectIds = [...nowInvalidIds];
      });
      const collection = getProjectCollection();
      const proj = collection.toArray.find((p) => p.id === projId);
      if (proj?.invalid) {
        collection.update(projId, (draft) => {
          draft.invalid = false;
        });
      }
    }

    // --- Persist ---
    if (diffStatsChanged) {
      const mergedStats: StatsMap = { ...prevStats, [projId]: nextProjectStats };
      setStatsMap(mergedStats);
      setSetting(DIFF_STATS_SETTING_KEY, mergedStats);
    }
  }, []);

  // ── Track miss counts for invalid project detection ──

  const trackMisses = useCallback(
    (polledPaths: string[], resultPaths: Set<string>, pathToId: Map<string, string>) => {
      const misses = missCountRef.current;
      let invalidChanged = false;

      for (const path of polledPaths) {
        const projId = pathToId.get(path);
        if (!projId) continue;

        if (resultPaths.has(path)) {
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
        const collection = getProjectCollection();
        for (const [id, count] of Object.entries(misses)) {
          const shouldBeInvalid = count >= MISS_THRESHOLD;
          const proj = collection.toArray.find((p) => p.id === id);
          if (proj && proj.invalid !== shouldBeInvalid) {
            collection.update(id, (draft) => {
              draft.invalid = shouldBeInvalid;
            });
          }
        }
      }
    },
    [],
  );

  // Stable project key for the effect dependency
  const projectKey = useMemo(
    () => projects.map((p) => `${p.id}:${p.expanded ? 1 : 0}`).join(','),
    [projects],
  );

  // ── Main effect: manage watchers + event listener + fallback poll ──

  useEffect(() => {
    if (!enabled) {
      pauseWatchers().catch(() => {});
      return;
    }

    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setInterval>;
    let unlisten: (() => void) | undefined;

    async function setup() {
      await resumeWatchers().catch(() => {});

      const cloningIds = new Set(getUiState().cloningProjectIds);
      const current = projectsRef.current;
      const { paths, pathToId } = getExpandedProjectPaths(
        cloningIds.size > 0 ? current.filter((p) => !cloningIds.has(p.id)) : current,
      );

      const desiredPaths = new Set(paths);
      const active = activeWatchersRef.current;

      // Start watchers for new paths
      for (const path of desiredPaths) {
        if (!active.has(path)) {
          startProjectWatcher(path).catch((e) =>
            console.warn(`[watcher] failed to start watcher for ${path}:`, e),
          );
          active.add(path);
        }
      }

      // Stop watchers for removed/collapsed paths
      for (const path of active) {
        if (!desiredPaths.has(path)) {
          stopProjectWatcher(path).catch(() => {});
          active.delete(path);
        }
      }

      // Listen for project-state-changed events from Rust
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<ProjectStateChangedEvent>('project-state-changed', (event) => {
        if (cancelled) return;
        const { pathToId: currentPathToId } = getExpandedProjectPaths(projectsRef.current);
        const projId = currentPathToId.get(event.payload.projectPath);
        if (projId) {
          processStateUpdate(projId, event.payload.state);
        }
      });

      // Fallback poll: 30s safety net (also handles invalid project detection)
      fallbackTimer = setInterval(() => {
        if (cancelled) return;
        const currentProjects = projectsRef.current;
        const currentCloningIds = new Set(getUiState().cloningProjectIds);
        const { paths: currentPaths, pathToId: currentPathToId } = getExpandedProjectPaths(
          currentCloningIds.size > 0
            ? currentProjects.filter((p) => !currentCloningIds.has(p.id))
            : currentProjects,
        );
        if (currentPaths.length === 0) return;

        pollAllProjectStates(currentPaths)
          .then((result) => {
            if (cancelled) return;
            const resultPaths = new Set(Object.keys(result));
            trackMisses(currentPaths, resultPaths, currentPathToId);
            for (const [path, state] of Object.entries(result)) {
              const id = currentPathToId.get(path);
              if (id) processStateUpdate(id, state);
            }
          })
          .catch(() => {});
      }, FALLBACK_POLL_MS);

      // Initial poll for fresh data on mount
      if (paths.length > 0) {
        pollAllProjectStates(paths)
          .then((result) => {
            if (cancelled) return;
            for (const [path, state] of Object.entries(result)) {
              const id = pathToId.get(path);
              if (id) processStateUpdate(id, state);
            }
          })
          .catch(() => {});
      }
    }

    // Copy ref value before cleanup runs (exhaustive-deps rule)
    const active = activeWatchersRef.current;

    void setup();

    return () => {
      cancelled = true;
      clearInterval(fallbackTimer);
      unlisten?.();

      for (const path of active) {
        stopProjectWatcher(path).catch(() => {});
      }
      active.clear();
    };
  }, [projectKey, enabled, processStateUpdate, trackMisses]);

  return statsMap;
}
