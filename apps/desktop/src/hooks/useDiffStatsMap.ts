import { useState, useRef, useEffect, useMemo } from 'react';
import { getAllDiffStats } from '../lib/git';
import type { DiffStat } from '../lib/git';
import type { Workspace } from '@superagent/db';

const DIFF_POLL_MS = 10_000;

/** Fetch diff stats for all workspaces, keyed by workspace ID then branch name. */
export function useDiffStatsMap(
  workspaces: Workspace[],
  enabled: boolean,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<Record<string, Record<string, DiffStat>>>({});
  const workspacesRef = useRef(workspaces);
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

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function fetchStats() {
      const current = workspacesRef.current;
      const expandedWs = current.filter((ws) => ws.expanded);
      const pathToId = new Map(expandedWs.map((ws) => [ws.path, ws.id]));
      const paths = expandedWs.map((ws) => ws.path);
      if (paths.length === 0) {
        timer = setTimeout(fetchStats, DIFF_POLL_MS);
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
            if (Object.keys(prev).length !== Object.keys(merged).length) return merged;
            for (const wsId in merged) {
              const prevWs = prev[wsId];
              const mergedWs = merged[wsId];
              if (!prevWs) return merged;
              const prevKeys = Object.keys(prevWs);
              const mergedKeys = Object.keys(mergedWs);
              if (prevKeys.length !== mergedKeys.length) return merged;
              for (const k of mergedKeys) {
                if (
                  prevWs[k]?.additions !== mergedWs[k]?.additions ||
                  prevWs[k]?.deletions !== mergedWs[k]?.deletions
                )
                  return merged;
              }
            }
            return prev;
          });
          timer = setTimeout(fetchStats, DIFF_POLL_MS);
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(fetchStats, DIFF_POLL_MS);
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
