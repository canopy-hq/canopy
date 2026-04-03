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
        .map((ws) => `${ws.id}:${ws.branches.length}:${ws.worktrees.length}`)
        .join(','),
    [workspaces],
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function fetchStats() {
      const current = workspacesRef.current;
      const pathToId = new Map(current.map((ws) => [ws.path, ws.id]));
      const paths = current.map((ws) => ws.path);
      if (paths.length === 0) {
        timer = setTimeout(fetchStats, DIFF_POLL_MS);
        return;
      }

      getAllDiffStats(paths)
        .then((result) => {
          if (cancelled) return;
          const next: Record<string, Record<string, DiffStat>> = {};
          for (const [path, stats] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (id) next[id] = stats;
          }
          setStatsMap((prev) => {
            if (Object.keys(prev).length !== Object.keys(next).length) return next;
            for (const wsId in next) {
              const prevWs = prev[wsId];
              const nextWs = next[wsId];
              if (!prevWs) return next;
              const prevKeys = Object.keys(prevWs);
              const nextKeys = Object.keys(nextWs);
              if (prevKeys.length !== nextKeys.length) return next;
              for (const k of nextKeys) {
                if (
                  prevWs[k]?.additions !== nextWs[k]?.additions ||
                  prevWs[k]?.deletions !== nextWs[k]?.deletions
                )
                  return next;
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

  return statsMap;
}
