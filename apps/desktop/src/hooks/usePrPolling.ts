import { useState, useRef, useEffect, useMemo } from 'react';

import { getSettingCollection, getSetting, setSetting } from '@superagent/db';

import { getPrStatuses } from '../lib/github';
import { getExpandedProjectPaths } from '../lib/project-utils';

import type { PrInfo } from '../lib/github';
import type { Project } from '@superagent/db';

const PR_SETTING_KEY = 'prStatuses';

function loadCachedPrMap(): PrMap {
  const settings = getSettingCollection().toArray;
  return getSetting<PrMap>(settings, PR_SETTING_KEY, {});
}

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
    if (!aWs || !bWs) return false;
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
  projects: Project[],
  enabled: boolean,
  githubConnected: boolean,
): PrMap {
  const [prMap, setPrMap] = useState<PrMap>(loadCachedPrMap);
  const projectsRef = useRef(projects);
  const noChangeCountRef = useRef(0);
  const prevPrMapRef = useRef(prMap);
  const inaccessiblePathsRef = useRef(new Set<string>());
  prevPrMapRef.current = prMap;

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Reset inaccessible paths when GitHub connection changes (user re-authed)
  useEffect(() => {
    inaccessiblePathsRef.current = new Set();
  }, [githubConnected]);

  const projectKey = useMemo(() => projects.map((p) => p.id).join(','), [projects]);

  useEffect(() => {
    if (!enabled || !githubConnected) return;
    noChangeCountRef.current = 0;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = projectsRef.current;
      const { paths, pathToId, expandedIds } = getExpandedProjectPaths(current);

      // Filter out paths we know are inaccessible
      const accessiblePaths = paths.filter((p) => !inaccessiblePathsRef.current.has(p));

      if (accessiblePaths.length === 0) {
        console.debug('[pr-poll] no accessible paths, skipping');
        timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        return;
      }

      console.debug(`[pr-poll] fetching PRs for ${accessiblePaths.length} repo(s)`);
      getPrStatuses(accessiblePaths)
        .then((result) => {
          if (cancelled) return;

          // Track newly discovered inaccessible paths
          if (result.inaccessiblePaths.length > 0) {
            console.debug(
              `[pr-poll] ${result.inaccessiblePaths.length} repo(s) inaccessible, skipping on future polls`,
            );
          }
          for (const path of result.inaccessiblePaths) {
            inaccessiblePathsRef.current.add(path);
          }

          const nextPrMap: PrMap = {};
          for (const [path, prs] of Object.entries(result.prs)) {
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
            if (!expandedIds.has(wsId)) merged[wsId] = prev[wsId]!;
          }
          for (const wsId in nextPrMap) {
            merged[wsId] = nextPrMap[wsId]!;
          }

          const totalPrs = Object.values(merged).reduce((n, m) => n + Object.keys(m).length, 0);
          if (!prMapEqual(prev, merged)) {
            noChangeCountRef.current = 0;
            console.debug(
              `[pr-poll] updated: ${totalPrs} PR(s) across ${Object.keys(merged).length} project(s)`,
            );
            setPrMap(merged);
            setSetting(PR_SETTING_KEY, merged);
          } else {
            noChangeCountRef.current += 1;
          }

          const nextInterval = getPrInterval(noChangeCountRef.current);
          console.debug(
            `[pr-poll] next poll in ${nextInterval / 1000}s (${noChangeCountRef.current} unchanged)`,
          );
          timer = setTimeout(poll, nextInterval);
        })
        .catch((err) => {
          console.debug('[pr-poll] error:', err);
          if (!cancelled) timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        });
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectKey, enabled, githubConnected]);

  return prMap;
}
