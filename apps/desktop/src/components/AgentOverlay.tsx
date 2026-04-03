import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { tv } from 'tailwind-variants';
import { useNavigate } from '@tanstack/react-router';

import { useAgents, useWorkspaces, useTabs } from '../hooks/useCollections';
import { switchTab } from '../lib/tab-actions';
import { StatusDot } from './StatusDot';

import type { PaneNode } from '../lib/pane-tree-ops';
import type { AgentInfo } from '@superagent/db';

export interface AgentOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatDuration(startedAt: number): string {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
}

/** Recursively check if a pane tree contains a leaf with the given ptyId */
function treeContainsPty(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((child) => treeContainsPty(child, ptyId));
}

interface AgentRow {
  agent: AgentInfo;
  workspaceName: string;
  tabId: string;
  workspaceItemId: string;
}

const agentRowStyle = tv({
  base: 'flex h-9 cursor-pointer items-center gap-2 rounded-md border-l-2 px-4',
  variants: {
    state: {
      waiting: 'border-transparent bg-(--agent-waiting-glow)',
      selected: 'border-accent bg-bg-tertiary',
      idle: 'border-transparent bg-transparent',
    },
  },
  defaultVariants: {
    state: 'idle',
  },
});

export function AgentOverlay({ isOpen, onClose }: AgentOverlayProps) {
  const navigate = useNavigate();
  const agentList = useAgents();
  const runningCount = agentList.filter((a) => a.status === 'running').length;
  const waitingCount = agentList.filter((a) => a.status === 'waiting').length;
  const workspaces = useWorkspaces();
  const tabs = useTabs();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setTick] = useState(0);

  // Live ticking: force re-render every second while open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Reset selection when opening
  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [isOpen]);

  // Build agent rows with workspace mapping
  const agentRows: AgentRow[] = useMemo(() => {
    const rows: AgentRow[] = [];

    for (const agent of agentList) {
      let workspaceName = 'Unknown';
      let tabId = '';
      let workspaceItemId = '';

      // Find which tab contains this agent's ptyId
      for (const tab of tabs) {
        if (treeContainsPty(tab.paneRoot, agent.ptyId)) {
          tabId = tab.id;
          workspaceItemId = tab.workspaceItemId;
          // Look up workspace name from workspace store
          const ws = workspaces.find((w) => {
            // Check if any branch/worktree id matches workspaceItemId
            // workspaceItemId could be the workspace id or a sub-item id
            return (
              w.id === tab.workspaceItemId ||
              w.branches.some((b) => b.name === tab.workspaceItemId) ||
              w.worktrees.some((wt) => wt.name === tab.workspaceItemId)
            );
          });
          if (ws) workspaceName = ws.name;
          break;
        }
      }

      rows.push({ agent, workspaceName, tabId, workspaceItemId });
    }

    return rows;
  }, [agentList, tabs, workspaces]);

  // Group rows by workspace name
  const groupedRows: Record<string, AgentRow[]> = useMemo(() => {
    const groups: Record<string, AgentRow[]> = {};
    for (const row of agentRows) {
      if (!groups[row.workspaceName]) groups[row.workspaceName] = [];
      groups[row.workspaceName]!.push(row);
    }
    return groups;
  }, [agentRows]);

  // Flat list for keyboard navigation
  const flatRows: AgentRow[] = useMemo(() => {
    const flat: AgentRow[] = [];
    for (const group of Object.values(groupedRows)) {
      flat.push(...group);
    }
    return flat;
  }, [groupedRows]);

  const handleJump = useCallback(
    (row: AgentRow) => {
      if (row.tabId) {
        void navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId: row.workspaceItemId },
        });
        switchTab(row.tabId);
      }
      onClose();
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (flatRows.length === 0 ? 0 : (prev + 1) % flatRows.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            flatRows.length === 0 ? 0 : (prev - 1 + flatRows.length) % flatRows.length,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (flatRows.length > 0 && flatRows[selectedIndex]) {
            handleJump(flatRows[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatRows, selectedIndex, handleJump, onClose],
  );

  if (!isOpen) return null;

  const hasAgents = flatRows.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="fixed top-1/2 left-1/2 flex max-h-[60vh] w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-[12px]"
        style={{
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
        onKeyDown={handleKeyDown}
      >
        <Dialog className="outline-none" aria-label="Agent Overview">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border p-4">
            <Heading slot="title" className="m-0 text-sm font-semibold text-text-primary">
              Agent Overview
            </Heading>
            {(runningCount > 0 || waitingCount > 0) && (
              <span className="flex items-center gap-1.5 text-[11px]">
                {runningCount > 0 && (
                  <span className="text-(--agent-running)">{runningCount} running</span>
                )}
                {runningCount > 0 && waitingCount > 0 && (
                  <span className="text-text-muted opacity-60">{'\u00B7'}</span>
                )}
                {waitingCount > 0 && (
                  <span className="text-(--agent-waiting)">{waitingCount} waiting</span>
                )}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="scrollbar-none flex-1 overflow-y-auto py-2">
            {!hasAgents ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
                <span className="text-sm font-semibold text-text-muted">No agents running</span>
                <span className="text-[13px] text-text-muted opacity-60">
                  Start an AI agent in any terminal to see it here
                </span>
              </div>
            ) : (
              /* Agent rows grouped by workspace */
              Object.entries(groupedRows).map(([wsName, rows]) => (
                <div key={wsName}>
                  {/* Group header */}
                  <div className="px-4 pt-2 pb-1 text-[11px] font-semibold text-text-muted">
                    {wsName}
                  </div>
                  {/* Agent rows */}
                  {rows.map((row) => {
                    const flatIndex = flatRows.indexOf(row);
                    const isSelected = flatIndex === selectedIndex;
                    const isWaiting = row.agent.status === 'waiting';
                    const state = isWaiting ? 'waiting' as const : isSelected ? 'selected' as const : 'idle' as const;

                    return (
                      <div
                        key={row.agent.ptyId}
                        data-testid={`agent-row-${row.agent.ptyId}`}
                        onClick={() => handleJump(row)}
                        className={agentRowStyle({ state })}
                        data-selected={isSelected}
                      >
                        <StatusDot status={row.agent.status} size={8} />
                        <span className="shrink-0 text-[13px] text-text-primary">
                          {row.agent.agentName}
                        </span>
                        <span className="flex-1 truncate text-[13px] text-text-muted">
                          {row.workspaceName}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                          {formatDuration(row.agent.startedAt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Dialog>
      </div>
    </div>
  );
}
