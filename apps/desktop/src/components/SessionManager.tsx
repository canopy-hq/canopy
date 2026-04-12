import { useState, useEffect, useCallback, useMemo } from 'react';
import { Header, Menu, MenuItem, Section } from 'react-aria-components';

import { closePty, listPtySessions } from '@canopy/terminal';
import { Button, SectionLabel } from '@canopy/ui';
import { useNavigate } from '@tanstack/react-router';

import { useTabs, useProjects } from '../hooks/useCollections';
import { containsPtyId } from '../lib/pane-tree-ops';
import { getProjectItemIds } from '../lib/project-actions';
import { killPaneInTab, jumpToPane } from '../lib/tab-actions';

import type { Tab, Project } from '@canopy/db';
import type { PtySessionInfo } from '@canopy/terminal';

export interface SessionManagerProps {
  onClose: () => void;
}

function findTabForPtyId(tabs: Tab[], ptyId: number): Tab | null {
  for (const tab of tabs) {
    if (containsPtyId(tab.paneRoot, ptyId)) return tab;
  }
  return null;
}

function findProjectForTab(tab: Tab, projects: Project[]): Project | null {
  return projects.find((p) => getProjectItemIds(p).has(tab.projectItemId)) ?? null;
}

interface SessionRow {
  info: PtySessionInfo;
  tab: Tab | null;
  projectName: string;
  projectItemId: string;
}

/**
 * Mounted only when the panel is open — polling starts on mount, stops on unmount.
 */
export function SessionManager({ onClose }: SessionManagerProps) {
  const tabs = useTabs();
  const projects = useProjects();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const [killing, setKilling] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (document.visibilityState === 'hidden') return;
      try {
        const data = await listPtySessions();
        if (!cancelled) setSessions(data);
      } catch {
        // ignore transient errors
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !cancelled) {
        void poll();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const rows: SessionRow[] = useMemo(
    () =>
      sessions.map((info) => {
        const tab = findTabForPtyId(tabs, info.ptyId);
        const proj = tab ? findProjectForTab(tab, projects) : null;
        return {
          info,
          tab,
          projectName: proj?.name ?? 'Unknown',
          projectItemId: tab?.projectItemId ?? '',
        };
      }),
    [sessions, tabs, projects],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const row of rows) {
      const group = map.get(row.projectName) ?? [];
      group.push(row);
      map.set(row.projectName, group);
    }
    return map;
  }, [rows]);

  const handleJump = useCallback(
    (row: SessionRow) => {
      if (!row.tab) return;
      jumpToPane(navigate, row.projectItemId, row.tab.id);
      onClose();
    },
    [navigate, onClose],
  );

  const handleKill = useCallback(async (row: SessionRow) => {
    const { ptyId, paneId } = row.info;
    setKilling((prev) => new Set(prev).add(ptyId));
    try {
      await closePty(ptyId);
      if (row.tab) killPaneInTab(row.tab.id, paneId);
      setSessions((prev) => prev.filter((s) => s.ptyId !== ptyId));
    } finally {
      setKilling((prev) => {
        const next = new Set(prev);
        next.delete(ptyId);
        return next;
      });
    }
  }, []);

  const handleKillGroup = useCallback(async (groupRows: SessionRow[]) => {
    if (groupRows.length === 0) return;
    const killedPtyIds = new Set(groupRows.map((r) => r.info.ptyId));
    setKilling((prev) => {
      const next = new Set(prev);
      killedPtyIds.forEach((id) => next.add(id));
      return next;
    });
    await Promise.all(
      groupRows.map(async (row) => {
        try {
          await closePty(row.info.ptyId);
          if (row.tab) killPaneInTab(row.tab.id, row.info.paneId);
        } catch {
          // ignore individual errors
        }
      }),
    );
    setSessions((prev) => prev.filter((s) => !killedPtyIds.has(s.ptyId)));
    setKilling((prev) => {
      const next = new Set(prev);
      killedPtyIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  return (
    <>
      <div className="px-3 pt-2 pb-1">
        <SectionLabel>PTY Sessions</SectionLabel>
      </div>

      {rows.length === 0 ? (
        <div className="px-3 py-3 text-xs text-fg-faint">No active sessions.</div>
      ) : (
        <Menu
          className="max-h-80 overflow-y-auto p-1 outline-none"
          onAction={(key) => {
            const ptyId = parseInt(String(key), 10);
            const row = rows.find((r) => r.info.ptyId === ptyId);
            if (row) handleJump(row);
          }}
        >
          {Array.from(grouped.entries()).map(([projName, groupRows]) => (
            <Section key={projName}>
              <Header className="group/section flex h-6 items-center gap-2 px-2">
                <SectionLabel className="flex-1">{projName}</SectionLabel>
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  aria-label={`Kill all sessions in ${projName}`}
                  onPress={() => void handleKillGroup(groupRows)}
                  isDisabled={groupRows.every((r) => killing.has(r.info.ptyId))}
                >
                  Kill all
                </Button>
              </Header>

              {groupRows.map((row) => (
                <MenuItem
                  key={row.info.ptyId}
                  id={row.info.ptyId}
                  isDisabled={!row.tab}
                  className="flex cursor-default items-center gap-1.5 rounded px-2 py-1 text-xs text-fg outline-none transition-colors data-[disabled]:opacity-40 data-[focused]:bg-surface"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {row.tab?.label ?? '—'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-faint">
                    {row.info.cpuPercent.toFixed(1)}% · {row.info.memoryMb}MB
                  </span>
                  <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      className="shrink-0"
                      onPress={() => void handleKill(row)}
                      isDisabled={killing.has(row.info.ptyId)}
                    >
                      kill
                    </Button>
                  </div>
                </MenuItem>
              ))}
            </Section>
          ))}
        </Menu>
      )}
    </>
  );
}
