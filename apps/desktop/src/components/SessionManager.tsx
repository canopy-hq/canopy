import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { closePty, listPtySessions } from '@superagent/terminal';
import { useNavigate } from '@tanstack/react-router';

import { useTabs, useWorkspaces } from '../hooks/useCollections';
import { containsPtyId } from '../lib/pane-tree-ops';
import { killPaneInTab, jumpToPane } from '../lib/tab-actions';
import { getWorkspaceItemIds } from '../lib/workspace-actions';
import { Button } from './ui';

import type { Tab, Workspace } from '@superagent/db';
import type { PtySessionInfo } from '@superagent/terminal';

export interface SessionManagerProps {
  onClose: () => void;
}

function findTabForPtyId(tabs: Tab[], ptyId: number): Tab | null {
  for (const tab of tabs) {
    if (containsPtyId(tab.paneRoot, ptyId)) return tab;
  }
  return null;
}

function findWorkspaceForTab(tab: Tab, workspaces: Workspace[]): Workspace | null {
  return workspaces.find((w) => getWorkspaceItemIds(w).has(tab.workspaceItemId)) ?? null;
}

interface SessionRow {
  info: PtySessionInfo;
  tab: Tab | null;
  workspaceName: string;
  workspaceItemId: string;
}

/**
 * Mounted only when the panel is open — polling starts on mount, stops on unmount.
 */
export function SessionManager({ onClose }: SessionManagerProps) {
  const tabs = useTabs();
  const workspaces = useWorkspaces();
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
        const ws = tab ? findWorkspaceForTab(tab, workspaces) : null;
        return {
          info,
          tab,
          workspaceName: ws?.name ?? 'Unknown',
          workspaceItemId: tab?.workspaceItemId ?? '',
        };
      }),
    [sessions, tabs, workspaces],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const row of rows) {
      const group = map.get(row.workspaceName) ?? [];
      group.push(row);
      map.set(row.workspaceName, group);
    }
    return map;
  }, [rows]);

  const handleJump = useCallback(
    (row: SessionRow) => {
      if (!row.tab) return;
      jumpToPane(navigate, row.workspaceItemId, row.tab.id);
      onClose();
    },
    [navigate, onClose],
  );

  const handleKill = useCallback(async (row: SessionRow) => {
    const { ptyId, paneId } = row.info;
    setKilling((prev) => new Set(prev).add(ptyId));
    try {
      await closePty(ptyId);
      // Only mark pane as killed if the tab still exists; orphan sessions
      // (PTY alive in daemon but tab already deleted) just need closePty.
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

  const handleKillAll = useCallback(async () => {
    await handleKillGroup(rows);
  }, [handleKillGroup, rows]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <Modal
        className="flex max-h-[60vh] w-[600px] flex-col rounded-xl border border-border font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
        }}
        onKeyDown={handleKeyDown}
      >
        <Dialog className="flex min-h-0 flex-col outline-none" aria-label="PTY Session Manager">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-4">
            <Heading slot="title" className="m-0 text-sm font-semibold text-text-primary">
              PTY Sessions
            </Heading>
            {rows.length > 0 && (
              <span className="text-ui-sm text-text-muted">
                {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
            <div className="flex-1" />
            {rows.length > 0 && (
              <Button
                variant="destructive-ghost"
                size="sm"
                className="shrink-0"
                onPress={() => void handleKillAll()}
                isDisabled={rows.every((r) => killing.has(r.info.ptyId))}
              >
                Kill all
              </Button>
            )}
          </div>

          {/* Body — scrollable */}
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
                <span className="text-sm font-semibold text-text-muted">No active sessions</span>
                <span className="text-ui-base text-text-muted opacity-60">
                  Open a terminal tab to start a PTY session
                </span>
              </div>
            ) : (
              Array.from(grouped.entries()).map(([wsName, groupRows]) => (
                <div key={wsName}>
                  {/* Group header */}
                  <div className="flex items-center px-4 pt-2 pb-1">
                    <span className="flex-1 text-ui-sm font-semibold tracking-wide text-text-muted uppercase opacity-60">
                      {wsName}
                    </span>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      aria-label={`Kill all sessions in ${wsName}`}
                      onPress={() => void handleKillGroup(groupRows)}
                      isDisabled={groupRows.every((r) => killing.has(r.info.ptyId))}
                    >
                      Kill all
                    </Button>
                  </div>

                  {/* Session rows */}
                  {groupRows.map((row) => (
                    <div
                      key={row.info.ptyId}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-bg-tertiary/50"
                    >
                      {/* Tab label */}
                      <span className="min-w-0 flex-1 truncate text-ui-base text-text-primary">
                        {row.tab?.label ?? '—'}
                      </span>

                      {/* Stats */}
                      <span className="shrink-0 text-ui-sm text-text-muted tabular-nums">
                        PID {row.info.ptyId}
                      </span>
                      <span className="w-[48px] shrink-0 text-right text-ui-sm text-text-muted tabular-nums">
                        {row.info.cpuPercent.toFixed(1)}%
                      </span>
                      <span className="w-[44px] shrink-0 text-right text-ui-sm text-text-muted tabular-nums">
                        {row.info.memoryMb}MB
                      </span>

                      {/* Jump */}
                      <Button
                        variant="ghost"
                        iconOnly
                        isDisabled={!row.tab}
                        aria-label="Go to tab"
                        className="shrink-0 p-1"
                        onPress={() => handleJump(row)}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
                          <path d="M10 2h4v4" />
                          <line x1="14" y1="2" x2="7" y2="9" />
                        </svg>
                      </Button>

                      {/* Kill */}
                      <Button
                        variant="destructive-ghost"
                        size="sm"
                        className="shrink-0"
                        onPress={() => void handleKill(row)}
                        isDisabled={killing.has(row.info.ptyId)}
                      >
                        Kill
                      </Button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
