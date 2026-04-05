import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { Loader2, PanelLeft, SquareTerminal } from 'lucide-react';

import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { Kbd } from '../../components/ui';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { setActiveContext, addTab } from '../../lib/tab-actions';
import { toggleSidebar } from '../../lib/workspace-actions';

function CreatingWorktree() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Loader2 size={16} className="animate-spin text-text-faint" />
      <span className="font-mono text-sm text-text-faint">Creating worktree…</span>
    </div>
  );
}

function WorkspaceRoute() {
  const { workspaceId } = Route.useParams();
  const ui = useUiState();
  const allTabs = useTabs();
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);

  // Sync store state when navigating to a workspace URL directly (routing is source of truth)
  useEffect(() => {
    if (ui.activeContextId !== workspaceId) {
      setActiveContext(workspaceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const isCreating = ui.creatingWorktreeIds.includes(workspaceId);

  return (
    <>
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {isCreating ? (
          <CreatingWorktree />
        ) : activeTab ? (
          <div key={activeTab.id} className="absolute inset-0">
            <PaneContainer root={activeTab.paneRoot} />
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 select-none">
      <button
        type="button"
        onClick={() => addTab()}
        className="flex w-72 items-center gap-3 rounded-md px-4 py-3 text-text-faint transition-colors hover:bg-white/[0.04] hover:text-text-muted"
      >
        <SquareTerminal size={15} className="shrink-0" />
        <span className="flex-1 text-left font-mono text-base">New Terminal</span>
        <Kbd>⌘T</Kbd>
      </button>
      <button
        type="button"
        onClick={() => toggleSidebar()}
        className="flex w-72 items-center gap-3 rounded-md px-4 py-3 text-text-faint transition-colors hover:bg-white/[0.04] hover:text-text-muted"
      >
        <PanelLeft size={15} className="shrink-0" />
        <span className="flex-1 text-left font-mono text-base">Toggle Sidebar</span>
        <Kbd>⌘B</Kbd>
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/workspaces/$workspaceId')({
  component: WorkspaceRoute,
});
