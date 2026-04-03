import { useState, useEffect, useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { useTabs } from '../hooks/useCollections';
import { closePaneInTab } from '../lib/tab-actions';
import { closePty, listPtySessions } from '@superagent/terminal';

import type { Tab } from '@superagent/db';
import type { PtySessionInfo } from '@superagent/terminal';
import type { PaneNode } from '../lib/pane-tree-ops';

export interface SessionManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

function findTabForPtyId(tabs: Tab[], ptyId: number): Tab | null {
  for (const tab of tabs) {
    if (treeContainsPty(tab.paneRoot, ptyId)) return tab;
  }
  return null;
}

function treeContainsPty(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((c) => treeContainsPty(c, ptyId));
}

interface SessionRow {
  info: PtySessionInfo;
  tab: Tab | null;
}

export function SessionManager({ isOpen, onClose }: SessionManagerProps) {
  const tabs = useTabs();
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const [killing, setKilling] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setSessions([]);
      return;
    }

    async function poll() {
      try {
        const data = await listPtySessions();
        setSessions(data);
      } catch {
        // ignore transient errors
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 2000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleKill = useCallback(
    async (row: SessionRow) => {
      if (!row.tab) return;
      const { ptyId, paneId } = row.info;
      setKilling((prev) => new Set(prev).add(ptyId));
      try {
        await closePty(ptyId);
        closePaneInTab(row.tab.id, paneId);
        setSessions((prev) => prev.filter((s) => s.ptyId !== ptyId));
      } finally {
        setKilling((prev) => {
          const next = new Set(prev);
          next.delete(ptyId);
          return next;
        });
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  const rows: SessionRow[] = sessions.map((info) => ({
    info,
    tab: findTabForPtyId(tabs, info.ptyId),
  }));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="fixed top-1/2 left-1/2 flex max-h-[60vh] w-[580px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
        }}
        onKeyDown={handleKeyDown}
      >
        <Dialog className="flex flex-col outline-none" aria-label="PTY Session Manager">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border p-4">
            <Heading slot="title" className="m-0 text-sm font-semibold text-text-primary">
              PTY Sessions
            </Heading>
            {rows.length > 0 && (
              <span className="text-[11px] text-text-muted">
                {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="scrollbar-none flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
                <span className="text-sm font-semibold text-text-muted">No active sessions</span>
                <span className="text-[13px] text-text-muted opacity-60">
                  Open a terminal tab to start a PTY session
                </span>
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-text-muted">
                    <th className="px-4 py-2 font-medium">Tab</th>
                    <th className="px-3 py-2 font-medium tabular-nums">PID</th>
                    <th className="px-3 py-2 font-medium tabular-nums">CPU%</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Mem</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.info.ptyId}
                      className="border-b border-border/50 last:border-0 hover:bg-bg-tertiary/50"
                    >
                      <td className="max-w-[200px] truncate px-4 py-2 text-text-primary">
                        {row.tab?.label ?? '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">{row.info.ptyId}</td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">
                        {row.info.cpuPercent.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">
                        {row.info.memoryMb}MB
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void handleKill(row)}
                          disabled={killing.has(row.info.ptyId) || !row.tab}
                          className="cursor-pointer rounded px-2 py-0.5 text-[11px] text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Kill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Dialog>
      </div>
    </div>
  );
}
