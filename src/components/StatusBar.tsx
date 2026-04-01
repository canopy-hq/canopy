import { useTabsStore } from '../stores/tabs-store';
import { useWorkspaceStore } from '../stores/workspace-store';
import type { PaneNode } from '../lib/pane-tree-ops';

function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

export function StatusBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const activeTab = tabs.find((t) => t.id === activeTabId);
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
              <span className="flex items-center gap-1">
                <span style={{ color: 'var(--branch-icon)' }}>&#x2387;</span>
                <span className="text-text-muted">{headBranch.name}</span>
              </span>
            )}
            <span className="text-text-muted">|</span>
          </>
        )}
        <span>
          {paneCount} {paneCount === 1 ? 'pane' : 'panes'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="opacity-60">Cmd+B Sidebar</span>
        <span className="opacity-60">Cmd+D Split</span>
        <span className="opacity-60">Cmd+T Tab</span>
        <span className="opacity-60">Cmd+Shift+O Overview</span>
      </div>
    </div>
  );
}
