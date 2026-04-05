import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';

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

  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[120px]"
    >
      <Modal
        className="flex max-h-[70vh] w-[600px] flex-col overflow-hidden rounded-xl border border-border/60 font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Dialog className="flex min-h-0 flex-col outline-none" aria-label="PTY Session Manager">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
            <span className="flex-1 text-[13px] text-text-primary">PTY Sessions</span>
            {rows.length > 0 && (
              <span className="font-mono text-[11px] text-text-faint tabular-nums">
                {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
            {rows.length > 0 && (
              <Button
                variant="destructive-ghost"
                size="sm"
                onPress={() => void handleKillAll()}
                isDisabled={rows.every((r) => killing.has(r.info.ptyId))}
              >
                Kill all
              </Button>
            )}
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {rows.length === 0 ? (
              <div className="flex items-center justify-center py-8 font-mono text-sm text-text-faint">
                No active sessions
              </div>
            ) : (
              Array.from(grouped.entries()).map(([wsName, groupRows]) => (
                <div key={wsName}>
                  <div className="flex h-7 items-center px-3">
                    <span className="flex-1 font-mono text-[10px] font-medium tracking-widest text-text-faint uppercase">
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

                  {groupRows.map((row) => (
                    <div
                      key={row.info.ptyId}
                      role="button"
                      tabIndex={row.tab ? 0 : -1}
                      onClick={() => handleJump(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleJump(row);
                      }}
                      className={`flex h-9 items-center gap-3 px-3 text-[13px] text-text-primary outline-none ${
                        row.tab
                          ? 'cursor-pointer hover:bg-bg-tertiary/50'
                          : 'cursor-default opacity-50'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.tab?.label ?? '—'}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-faint tabular-nums">
                        {row.info.cpuPercent.toFixed(1)}% · {row.info.memoryMb}MB
                      </span>
                      <div onClick={(e) => e.stopPropagation()}>
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
