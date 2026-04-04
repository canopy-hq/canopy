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

/** Shallow-compare two nested stats maps. Returns true if equal. */
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

/** Fetch diff stats for expanded workspaces, keyed by workspace ID then branch name. */
export function useDiffStatsMap(
  workspaces: Workspace[],
  enabled: boolean,
): Record<string, Record<string, DiffStat>> {
  const [statsMap, setStatsMap] = useState<Record<string, Record<string, DiffStat>>>({});
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  const prevStatsRef = useRef(statsMap);
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

          // Build merged: carry forward collapsed entries + fresh expanded data
          const prev = prevStatsRef.current;
          const merged: Record<string, Record<string, DiffStat>> = {};
          for (const wsId in prev) {
            if (!expandedIds.has(wsId)) merged[wsId] = prev[wsId];
          }
          for (const wsId in next) {
            merged[wsId] = next[wsId];
          }

          if (statsEqual(prev, merged)) {
            noChangeCountRef.current += 1;
          } else {
            noChangeCountRef.current = 0;
            setStatsMap(merged);
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

  return statsMap;
}
