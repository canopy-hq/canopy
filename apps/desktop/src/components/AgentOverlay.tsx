import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Heading } from 'react-aria-components';
import { useAgents, useWorkspaces, useTabs } from '../hooks/useCollections';
import { setActiveContext, switchTab } from '../lib/tab-actions';
import type { AgentInfo } from '@superagent/db';
import type { PaneNode } from '../lib/pane-tree-ops';
import { StatusDot } from './StatusDot';

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

export function AgentOverlay({ isOpen, onClose }: AgentOverlayProps) {
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
        setActiveContext(row.workspaceItemId);
        switchTab(row.tabId);
      }
      onClose();
    },
    [onClose],
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '520px',
          maxHeight: '60vh',
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column' as const,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        }}
        onKeyDown={handleKeyDown}
      >
        <Dialog
          className="outline-none"
          aria-label="Agent Overview"
        >
          {/* Header */}
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Heading
              slot="title"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Agent Overview
            </Heading>
            {(runningCount > 0 || waitingCount > 0) && (
              <span
                style={{
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {runningCount > 0 && (
                  <span style={{ color: 'var(--agent-running)' }}>
                    {runningCount} running
                  </span>
                )}
                {runningCount > 0 && waitingCount > 0 && (
                  <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                    {'\u00B7'}
                  </span>
                )}
                {waitingCount > 0 && (
                  <span style={{ color: 'var(--agent-waiting)' }}>
                    {waitingCount} waiting
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Body */}
          <div
            style={{
              overflowY: 'auto',
              scrollbarWidth: 'none',
              padding: '8px 0',
              flex: 1,
            }}
          >
            {!hasAgents ? (
              /* Empty state */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 16px',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  No agents running
                </span>
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    opacity: 0.6,
                  }}
                >
                  Start an AI agent in any terminal to see it here
                </span>
              </div>
            ) : (
              /* Agent rows grouped by workspace */
              Object.entries(groupedRows).map(([wsName, rows]) => (
                <div key={wsName}>
                  {/* Group header */}
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      padding: '8px 16px 4px 16px',
                    }}
                  >
                    {wsName}
                  </div>
                  {/* Agent rows */}
                  {rows.map((row) => {
                    const flatIndex = flatRows.indexOf(row);
                    const isSelected = flatIndex === selectedIndex;
                    const isWaiting = row.agent.status === 'waiting';

                    return (
                      <div
                        key={row.agent.ptyId}
                        data-testid={`agent-row-${row.agent.ptyId}`}
                        onClick={() => handleJump(row)}
                        style={{
                          height: '36px',
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '0 16px',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          background: isWaiting
                            ? 'var(--agent-waiting-glow)'
                            : isSelected
                              ? 'var(--bg-tertiary)'
                              : 'transparent',
                          borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                        }}
                        data-selected={isSelected}
                      >
                        <StatusDot status={row.agent.status} size={8} />
                        <span
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            flexShrink: 0,
                          }}
                        >
                          {row.agent.agentName}
                        </span>
                        <span
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-muted)',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.workspaceName}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}
                        >
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
