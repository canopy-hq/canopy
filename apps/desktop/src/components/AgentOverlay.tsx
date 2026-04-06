import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { useNavigate } from '@tanstack/react-router';
import { tv } from 'tailwind-variants';

import { useAgents, useProjects, useTabs } from '../hooks/useCollections';
import { containsPtyId } from '../lib/pane-tree-ops';
import { jumpToPane } from '../lib/tab-actions';
import { StatusDot } from './ui';

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

interface AgentRow {
  agent: AgentInfo;
  projectName: string;
  tabId: string;
  projectItemId: string;
}

const agentRowStyle = tv({
  base: 'flex h-9 items-center gap-2 rounded-md border-l-2 px-4',
  variants: {
    state: {
      waiting: 'border-transparent bg-(--agent-waiting-glow)',
      selected: 'border-accent bg-bg-tertiary',
      idle: 'border-transparent bg-transparent',
    },
  },
  defaultVariants: { state: 'idle' },
});

export function AgentOverlay({ isOpen, onClose }: AgentOverlayProps) {
  const navigate = useNavigate();
  const agentList = useAgents();
  const runningCount = agentList.filter((a) => a.status === 'running').length;
  const waitingCount = agentList.filter((a) => a.status === 'waiting').length;
  const projects = useProjects();
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

  const agentRows: AgentRow[] = useMemo(() => {
    const rows: AgentRow[] = [];

    for (const agent of agentList) {
      let projectName = 'Unknown';
      let tabId = '';
      let projectItemId = '';

      for (const tab of tabs) {
        if (containsPtyId(tab.paneRoot, agent.ptyId)) {
          tabId = tab.id;
          projectItemId = tab.projectItemId;
          // projectItemId is a composite key like `${proj.id}-branch-name`; match by prefix
          const proj = projects.find((p) => tab.projectItemId.startsWith(p.id));
          if (proj) projectName = proj.name;
          break;
        }
      }

      rows.push({ agent, projectName, tabId, projectItemId });
    }

    return rows;
  }, [agentList, tabs, projects]);

  // Group rows by project name
  const groupedRows: Record<string, AgentRow[]> = useMemo(() => {
    const groups: Record<string, AgentRow[]> = {};
    for (const row of agentRows) {
      if (!groups[row.projectName]) groups[row.projectName] = [];
      groups[row.projectName]!.push(row);
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
        jumpToPane(navigate, row.projectItemId, row.tabId);
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
        className="fixed top-1/2 left-1/2 flex max-h-[60vh] w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-bg-secondary/85 font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-[12px]"
        style={{ WebkitBackdropFilter: 'blur(12px)' }}
        onKeyDown={handleKeyDown}
      >
        <Dialog className="outline-none" aria-label="Agent Overview">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border p-4">
            <Heading slot="title" className="m-0 text-lg font-semibold text-text-primary">
              Agent Overview
            </Heading>
            {(runningCount > 0 || waitingCount > 0) && (
              <span className="flex items-center gap-1.5 text-sm">
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
              <div className="flex items-center justify-center py-8 font-mono text-sm text-text-faint">
                No agents running
              </div>
            ) : (
              Object.entries(groupedRows).map(([projName, rows]) => (
                <div key={projName}>
                  {/* Group header */}
                  <div className="px-4 pt-2 pb-1 text-sm font-semibold text-text-muted">
                    {projName}
                  </div>
                  {/* Agent rows */}
                  {rows.map((row) => {
                    const flatIndex = flatRows.indexOf(row);
                    const isSelected = flatIndex === selectedIndex;
                    const isWaiting = row.agent.status === 'waiting';
                    const state: 'waiting' | 'selected' | 'idle' = isWaiting
                      ? 'waiting'
                      : isSelected
                        ? 'selected'
                        : 'idle';

                    return (
                      <div
                        key={row.agent.ptyId}
                        data-testid={`agent-row-${row.agent.ptyId}`}
                        onClick={() => handleJump(row)}
                        className={agentRowStyle({ state })}
                        data-selected={isSelected}
                      >
                        <StatusDot status={row.agent.status} size={8} />
                        <span className="shrink-0 text-base text-text-primary">
                          {row.agent.agentName}
                        </span>
                        <span className="flex-1 truncate text-base text-text-muted">
                          {row.projectName}
                        </span>
                        <span className="shrink-0 text-sm text-text-muted tabular-nums">
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
