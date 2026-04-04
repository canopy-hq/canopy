import { useState, useRef, useEffect, useMemo } from 'react';

import { getWorkspaceCollection } from '@superagent/db';

import { listBranches, pollAllWorkspaceStates } from '../lib/git';

import type { BranchInfo, DiffStat, WorkspacePollState } from '../lib/git';
import type { Workspace } from '@superagent/db';

const POLL_MS = 3_000;

export function getInterval(noChangeCount: number): number {
  if (noChangeCount >= 10) return 15_000;
  if (noChangeCount >= 5) return 10_000;
  return POLL_MS;
}

/**
 * Merge fresh branches into the existing draft array in-place.
 * Updates changed fields on existing branches, appends new ones, removes deleted ones.
 * Minimizes object identity changes to prevent unnecessary React re-renders.
 */
export function mergeBranches(draft: BranchInfo[], fresh: BranchInfo[]): void {
  const freshByName = new Map(fresh.map((b) => [b.name, b]));
  const draftByName = new Map(draft.map((b) => [b.name, b]));

  // Update existing branches in place
  for (const existing of draft) {
    const updated = freshByName.get(existing.name);
    if (updated) {
      existing.is_head = updated.is_head;
      existing.ahead = updated.ahead;
      existing.behind = updated.behind;
    }
  }

  // Remove deleted branches (iterate backwards to safely splice)
  for (let i = draft.length - 1; i >= 0; i--) {
    if (!freshByName.has(draft[i].name)) {
      draft.splice(i, 1);
    }
  }

  // Append new branches
  for (const b of fresh) {
    if (!draftByName.has(b.name)) {
      draft.push(b);
    }
  }
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
    if (!aWs) return false;
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

/** Compare branch poll states for change detection across workspaces. */
export function branchStateEqual(
  a: Record<string, WorkspacePollState>,
  b: Record<string, WorkspacePollState>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const wsId of bKeys) {
    const aWs = a[wsId];
    const bWs = b[wsId];
    if (!aWs) return false;
    if (aWs.head_oid !== bWs.head_oid) return false;
    if (aWs.branches.length !== bWs.branches.length) return false;
    for (let i = 0; i < bWs.branches.length; i++) {
      if (aWs.branches[i].name !== bWs.branches[i].name) return false;
      if (aWs.branches[i].is_head !== bWs.branches[i].is_head) return false;
    }
    const aWtKeys = Object.keys(aWs.worktree_branches);
    const bWtKeys = Object.keys(bWs.worktree_branches);
    if (aWtKeys.length !== bWtKeys.length) return false;
    for (const wt of bWtKeys) {
      if (aWs.worktree_branches[wt] !== bWs.worktree_branches[wt]) return false;
    }
  }
  return true;
}

/** Identify which workspace IDs have changed branch state. */
function findChangedWorkspaces(
  prev: Record<string, WorkspacePollState>,
  next: Record<string, WorkspacePollState>,
): string[] {
  const changed: string[] = [];
  for (const wsId of Object.keys(next)) {
    const a = prev[wsId];
    const b = next[wsId];
    if (!a) {
      changed.push(wsId);
      continue;
    }
    if (a.head_oid !== b.head_oid) {
      changed.push(wsId);
      continue;
    }
    if (a.branches.length !== b.branches.length) {
      changed.push(wsId);
      continue;
    }
    let branchDiff = false;
    for (let i = 0; i < b.branches.length; i++) {
      if (
        a.branches[i].name !== b.branches[i].name ||
        a.branches[i].is_head !== b.branches[i].is_head
      ) {
        branchDiff = true;
        break;
      }
    }
    if (branchDiff) {
      changed.push(wsId);
      continue;
    }
    const aWtKeys = Object.keys(a.worktree_branches);
    const bWtKeys = Object.keys(b.worktree_branches);
    if (aWtKeys.length !== bWtKeys.length) {
      changed.push(wsId);
      continue;
    }
    for (const wt of bWtKeys) {
      if (a.worktree_branches[wt] !== b.worktree_branches[wt]) {
        changed.push(wsId);
        break;
      }
    }
  }
  return changed;
}

/**
 * Combined workspace polling hook: fetches diff stats + branch state in a single IPC call.
 * Returns diff stats map (same as former useDiffStatsMap).
 * Side-effect: updates workspace collection branches when changes are detected.
 */
export function useWorkspacePolling(
  workspaces: Workspace[],
  enabled: boolean,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<Record<string, Record<string, DiffStat>>>({});
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  const prevStatsRef = useRef(statsMap);
  const prevBranchStateRef = useRef<Record<string, WorkspacePollState>>({});
  prevStatsRef.current = statsMap;

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const workspaceKey = useMemo(
    () => workspaces.map((ws) => `${ws.id}:${ws.expanded ? 1 : 0}`).join(','),
    [workspaces],
  );

  useEffect(() => {
    if (!enabled) return;
    noChangeCountRef.current = 0;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = workspacesRef.current;
      const expandedWs = current.filter((ws) => ws.expanded);
      const pathToId = new Map(expandedWs.map((ws) => [ws.path, ws.id]));
      const idToPath = new Map(expandedWs.map((ws) => [ws.id, ws.path]));
      const paths = expandedWs.map((ws) => ws.path);
      if (paths.length === 0) {
        timer = setTimeout(poll, getInterval(noChangeCountRef.current));
        return;
      }

      const expandedIds = new Set(expandedWs.map((ws) => ws.id));

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
            if (!expandedIds.has(wsId)) mergedStats[wsId] = prevStats[wsId];
          }
          for (const wsId in nextStats) {
            mergedStats[wsId] = nextStats[wsId];
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
            if (!expandedIds.has(wsId)) mergedBranch[wsId] = prevBranch[wsId];
          }
          for (const wsId in nextBranchState) {
            mergedBranch[wsId] = nextBranchState[wsId];
          }

          const changedWsIds = findChangedWorkspaces(prevBranch, mergedBranch);
          const branchChanged = changedWsIds.length > 0;

          // Update branch data for changed workspaces
          if (branchChanged) {
            const collection = getWorkspaceCollection();
            await Promise.all(
              changedWsIds.map(async (wsId) => {
                const wsPath = idToPath.get(wsId);
                if (!wsPath) return;
                try {
                  // Full refresh: get ahead/behind for the changed repo
                  const fullBranches = await listBranches(wsPath);
                  collection.update(wsId, (draft) => {
                    mergeBranches(draft.branches, fullBranches);
                    // Update worktree branch names on existing entries only (preserve list + labels)
                    const wtBranches = mergedBranch[wsId]?.worktree_branches;
                    if (wtBranches) {
                      for (const wt of draft.worktrees) {
                        const newBranch = wtBranches[wt.name];
                        if (newBranch !== undefined) {
                          wt.branch = newBranch;
                        }
                      }
                    }
                  });
                } catch {
                  // Skip failed repos — they'll retry next cycle
                }
              }),
            );
          }

          prevBranchStateRef.current = mergedBranch;

          if (diffStatsChanged || branchChanged) {
            noChangeCountRef.current = 0;
            if (diffStatsChanged) setStatsMap(mergedStats);
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
