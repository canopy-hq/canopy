import { useState, useRef, useEffect, useMemo } from 'react';
import { getAllDiffStats } from '../lib/git';
import type { DiffStat } from '../lib/git';
import type { Workspace } from '@superagent/db';

const DIFF_POLL_MS = 10_000;

function getInterval(noChangeCount: number): number {
  if (noChangeCount >= 6) return 30_000;
  if (noChangeCount >= 3) return 20_000;
  return DIFF_POLL_MS;
}

/** Fetch diff stats for all workspaces, keyed by workspace ID then branch name. */
export function useDiffStatsMap(
  workspaces: Workspace[],
  enabled: boolean,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<Record<string, Record<string, DiffStat>>>({});
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const workspaceKey = useMemo(
    () =>
      workspaces
        .map((ws) => `${ws.id}:${ws.expanded ? 1 : 0}:${ws.branches.length}:${ws.worktrees.length}`)
        .join(','),
    [workspaces],
  );

  // Track previously expanded workspace IDs for immediate fetch on expand
  const prevExpandedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    noChangeCountRef.current = 0;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function fetchStats() {
      const current = workspacesRef.current;
      const expandedWs = current.filter((ws) => ws.expanded);
      const pathToId = new Map(expandedWs.map((ws) => [ws.path, ws.id]));
      const paths = expandedWs.map((ws) => ws.path);
      if (paths.length === 0) {
        timer = setTimeout(fetchStats, getInterval(noChangeCountRef.current));
        return;
      }

      const expandedIds = new Set(expandedWs.map((ws) => ws.id));

      getAllDiffStats(paths)
        .then((result) => {
          if (cancelled) return;
          const next: Record<string, Record<string, DiffStat>> = {};
          for (const [path, stats] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) next[id] = stats;
          }
          let changed = false;
          setStatsMap((prev) => {
            // Start with carried-forward collapsed entries
            const merged: Record<string, Record<string, DiffStat>> = {};
            for (const wsId in prev) {
              if (!expandedIds.has(wsId)) merged[wsId] = prev[wsId];
            }
            // Add fresh data for expanded workspaces
            for (const wsId in next) {
              merged[wsId] = next[wsId];
            }
            // Shallow equality — return prev reference if nothing changed
            if (Object.keys(prev).length !== Object.keys(merged).length) {
              changed = true;
              return merged;
            }
            for (const wsId in merged) {
              const prevWs = prev[wsId];
              const mergedWs = merged[wsId];
              if (!prevWs) {
                changed = true;
                return merged;
              }
              const prevKeys = Object.keys(prevWs);
              const mergedKeys = Object.keys(mergedWs);
              if (prevKeys.length !== mergedKeys.length) {
                changed = true;
                return merged;
              }
              for (const k of mergedKeys) {
                if (
                  prevWs[k]?.additions !== mergedWs[k]?.additions ||
                  prevWs[k]?.deletions !== mergedWs[k]?.deletions
                ) {
                  changed = true;
                  return merged;
                }
              }
            }
            return prev;
          });

          if (changed) {
            noChangeCountRef.current = 0;
          } else {
            noChangeCountRef.current += 1;
          }
          timer = setTimeout(fetchStats, getInterval(noChangeCountRef.current));
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(fetchStats, getInterval(noChangeCountRef.current));
        });
    }

    fetchStats();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceKey, enabled]);

  // Immediate fetch when a workspace transitions from collapsed to expanded
  useEffect(() => {
    if (!enabled) return;
    const currentExpanded = new Set(workspaces.filter((ws) => ws.expanded).map((ws) => ws.id));
    const prev = prevExpandedRef.current;
    const newlyExpanded = workspaces.filter(
      (ws) => currentExpanded.has(ws.id) && !prev.has(ws.id),
    );
    prevExpandedRef.current = currentExpanded;

    if (newlyExpanded.length === 0) return;

    // Fetch only the newly expanded workspaces immediately
    const paths = newlyExpanded.map((ws) => ws.path);
    const pathToId = new Map(newlyExpanded.map((ws) => [ws.path, ws.id]));
    getAllDiffStats(paths)
      .then((result) => {
        const fresh: Record<string, Record<string, DiffStat>> = {};
        for (const [path, stats] of Object.entries(result)) {
          const id = pathToId.get(path);
          if (id) fresh[id] = stats;
        }
        setStatsMap((prev) => ({ ...prev, ...fresh }));
      })
      .catch(() => {});
  }, [workspaces, enabled]);

  return statsMap;
}
