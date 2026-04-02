import { useState, useCallback } from 'react';
import { useTabs, useWorkspaces, useAgents, useUiState } from '../hooks/useCollections';
import type { PaneNode } from '../lib/pane-tree-ops';

function BranchLabel({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(name).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, [name]);

  return (
    <span
      className="flex items-center gap-1 cursor-pointer hover:text-text-primary transition-colors"
      onClick={handleClick}
      title="Click to copy branch name"
    >
      <span style={{ color: 'var(--branch-icon)' }}>&#x2387;</span>
      <span style={{ opacity: copied ? 0.5 : 1, transition: 'opacity 150ms' }}>{name}</span>
    </span>
  );
}

function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

export function StatusBar() {
  const tabs = useTabs();
  const ui = useUiState();
  const workspaces = useWorkspaces();
  const agents = useAgents();

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const waitingCount = agents.filter((a) => a.status === 'waiting').length;

  const activeTab = tabs.find((t) => t.id === ui.activeTabId);
  const paneCount = activeTab ? countLeaves(activeTab.paneRoot) : 0;

  const activeWorkspace = workspaces.length > 0 ? workspaces[0] : null;
  const headBranch = activeWorkspace?.branches.find((b) => b.is_head);

  return (
    <div
      className="h-6 flex items-center justify-between px-3 border-t border-border bg-bg-primary text-text-muted flex-shrink-0"
      style={{ fontSize: '11px', fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
    >
      <div className="flex items-center gap-3">
        {activeWorkspace && (
          <>
            <span className="text-text-primary" style={{ fontSize: '13px' }}>
              {activeWorkspace.name}
            </span>
            {headBranch && (
              <BranchLabel name={headBranch.name} />
            )}
            <span className="text-text-muted">|</span>
          </>
        )}
        <span>
          {paneCount} {paneCount === 1 ? 'pane' : 'panes'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {(runningCount > 0 || waitingCount > 0) && (
          <span className="flex items-center gap-1" style={{ fontSize: '11px' }}>
            {runningCount > 0 && (
              <span style={{ color: 'var(--agent-running)' }}>{runningCount} working</span>
            )}
            {runningCount > 0 && waitingCount > 0 && (
              <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>&middot;</span>
            )}
            {waitingCount > 0 && (
              <span style={{ color: 'var(--agent-waiting)' }}>{waitingCount} waiting</span>
            )}
          </span>
        )}
        <span className="opacity-60">Cmd+B Sidebar</span>
        <span className="opacity-60">Cmd+D Split</span>
        <span className="opacity-60">Cmd+T Tab</span>
        <span className="opacity-60">Cmd+Shift+O Overview</span>
      </div>
    </div>
  );
}
