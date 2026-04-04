import { useState, useRef, useEffect, useMemo } from 'react';

import { getPrStatuses } from '../lib/github';
import { getExpandedWorkspacePaths } from '../lib/workspace-utils';

import type { PrInfo } from '../lib/github';
import type { Workspace } from '@superagent/db';

const PR_POLL_MS = 30_000;

export type PrMap = Record<string, Record<string, PrInfo>>;

export function getPrInterval(noChangeCount: number): number {
  if (noChangeCount >= 10) return 120_000;
  if (noChangeCount >= 5) return 60_000;
  return PR_POLL_MS;
}

/** Shallow-compare two nested PR maps (wsId → branchName → PrInfo). */
export function prMapEqual(a: PrMap, b: PrMap): boolean {
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
      if (aWs[k]?.number !== bWs[k]?.number || aWs[k]?.state !== bWs[k]?.state) return false;
    }
  }
  return true;
}

/**
 * Dedicated PR status polling hook. Fully decoupled from local git polling.
 * Polls GitHub API on a 30s+ adaptive cadence. Never blocks local operations.
 */
export function usePrPolling(
  workspaces: Workspace[],
  enabled: boolean,
  githubConnected: boolean,
): PrMap {
  const [prMap, setPrMap] = useState<PrMap>({});
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  const prevPrMapRef = useRef(prMap);
  prevPrMapRef.current = prMap;

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const workspaceKey = useMemo(
    () => workspaces.map((ws) => `${ws.id}:${ws.expanded ? 1 : 0}`).join(','),
    [workspaces],
  );

  useEffect(() => {
    if (!enabled || !githubConnected) return;
    noChangeCountRef.current = 0;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = workspacesRef.current;
      const { paths, pathToId, expandedIds } = getExpandedWorkspacePaths(current);

      if (paths.length === 0) {
        timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        return;
      }

      getPrStatuses(paths)
        .then((result) => {
          if (cancelled) return;

          const nextPrMap: PrMap = {};
          for (const [path, prs] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (!id) continue;
            const byBranch: Record<string, PrInfo> = {};
            for (const pr of prs) {
              byBranch[pr.branch] = pr;
            }
            nextPrMap[id] = byBranch;
          }

          const prev = prevPrMapRef.current;
          const merged: PrMap = {};
          for (const wsId in prev) {
            if (!expandedIds.has(wsId)) merged[wsId] = prev[wsId];
          }
          for (const wsId in nextPrMap) {
            merged[wsId] = nextPrMap[wsId];
          }

          if (!prMapEqual(prev, merged)) {
            noChangeCountRef.current = 0;
            setPrMap(merged);
          } else {
            noChangeCountRef.current += 1;
          }

          timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        });
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceKey, enabled, githubConnected]);

  return prMap;
}
