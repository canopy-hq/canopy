import { useState, useRef, useEffect, useMemo } from 'react';

import {
  getSettingCollection,
  getSetting,
  getWorkspaceCollection,
  setSetting,
} from '@superagent/db';

import { pollAllWorkspaceStates } from '../lib/git';
import { getExpandedWorkspacePaths } from '../lib/workspace-utils';

import type { DiffStat, WorkspacePollState } from '../lib/git';
import type { Workspace } from '@superagent/db';

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
  for (const wsId of bKeys) {
    const aWs = a[wsId];
    const bWs = b[wsId];
    if (!aWs || !bWs) return false;
    const aK = Object.keys(aWs);
    const bK = Object.keys(bWs);
    if (aK.length !== bK.length) return false;
    for (const k of bK) {
      if (aWs[k]?.additions !== bWs[k]?.additions || aWs[k]?.deletions !== bWs[k]?.deletions)
        return false;
    }
  }
  return true;
}

/** Compare two single-workspace poll states. */
function workspaceStateEqual(a: WorkspacePollState, b: WorkspacePollState): boolean {
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

/** Identify which workspace IDs have changed branch state. */
function findChangedWorkspaces(
  prev: Record<string, WorkspacePollState>,
  next: Record<string, WorkspacePollState>,
): string[] {
  return Object.keys(next).filter((wsId) => {
    const a = prev[wsId];
    const b = next[wsId];
    if (!a || !b) return true;
    return !workspaceStateEqual(a, b);
  });
}

/** Compare branch poll states for change detection across workspaces. */
export function branchStateEqual(
  a: Record<string, WorkspacePollState>,
  b: Record<string, WorkspacePollState>,
): boolean {
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  return findChangedWorkspaces(a, b).length === 0;
}

/**
 * Combined workspace polling hook: fetches diff stats + branch state in a single IPC call.
 * Returns diff stats map (same as former useDiffStatsMap).
 * Side-effect: updates workspace collection branches when changes are detected.
 */
export function useWorkspacePolling(
  workspaces: Workspace[],
  enabled: boolean,
  resetKey?: string,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<StatsMap>(loadCachedStatsMap);
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  const prevStatsRef = useRef(statsMap);
  const prevBranchStateRef = useRef<Record<string, WorkspacePollState>>({});
  prevStatsRef.current = statsMap;

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const workspaceKey = useMemo(
    () =>
      workspaces.map((ws) => `${ws.id}:${ws.expanded ? 1 : 0}`).join(',') +
      (resetKey != null ? `|${resetKey}` : ''),
    [workspaces, resetKey],
  );

  useEffect(() => {
    if (!enabled) return;
    noChangeCountRef.current = 0;
    prevBranchStateRef.current = {};

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = workspacesRef.current;
      const { paths, pathToId, expandedIds } = getExpandedWorkspacePaths(current);
      if (paths.length === 0) {
        timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        return;
      }

      pollAllWorkspaceStates(paths)
        .then(async (result) => {
          if (cancelled) return;

          // --- Diff stats (same logic as before) ---
          const nextStats: Record<string, Record<string, DiffStat>> = {};
          for (const [path, state] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) nextStats[id] = state.diff_stats;
          }

          const prevStats = prevStatsRef.current;
          const mergedStats: Record<string, Record<string, DiffStat>> = {};
          for (const wsId in prevStats) {
            if (!expandedIds.has(wsId)) mergedStats[wsId] = prevStats[wsId]!;
          }
          for (const wsId in nextStats) {
            mergedStats[wsId] = nextStats[wsId]!;
          }

          const diffStatsChanged = !statsEqual(prevStats, mergedStats);

          // --- Branch state ---
          const nextBranchState: Record<string, WorkspacePollState> = {};
          for (const [path, state] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) nextBranchState[id] = state;
          }

          const prevBranch = prevBranchStateRef.current;
          const mergedBranch: Record<string, WorkspacePollState> = {};
          for (const wsId in prevBranch) {
            if (!expandedIds.has(wsId)) mergedBranch[wsId] = prevBranch[wsId]!;
          }
          for (const wsId in nextBranchState) {
            mergedBranch[wsId] = nextBranchState[wsId]!;
          }

          const changedWsIds = findChangedWorkspaces(prevBranch, mergedBranch);
          const branchChanged = changedWsIds.length > 0;

          // Update branch data for changed workspaces
          if (branchChanged) {
            const collection = getWorkspaceCollection();
            for (const wsId of changedWsIds) {
              const state = mergedBranch[wsId];
              if (!state) continue;
              const head = state.branches.find((b) => b.is_head);
              collection.update(wsId, (draft) => {
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
  }, [workspaceKey, enabled]);

  return statsMap;
}
