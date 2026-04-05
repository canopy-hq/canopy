import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';

import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { Button, Kbd } from '../../components/ui';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { setActiveContext, addTab } from '../../lib/tab-actions';
import { toggleSidebar } from '../../lib/workspace-actions';

function CreatingWorktree() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Loader2 size={20} className="animate-spin text-accent" />
      <span className="text-[14px] font-medium text-text-primary">Creating worktree…</span>
      <span className="text-[12px] text-text-muted">Setting up your workspace</span>
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

  const isCreating = ui.creatingWorktreeId === workspaceId;

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
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-1 select-none">
      <div className="mb-8 font-mono text-[42px] font-semibold tracking-[-2px] text-text-muted opacity-25">
        {'{ }'}
      </div>

      <Button
        variant="ghost"
        onPress={addTab}
        className="w-80 justify-start gap-3 px-4 py-2.5 text-lg"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <rect x="1" y="2.5" width="14" height="11" rx="2" />
          <path d="M4.5 6l2.5 2-2.5 2" />
          <path d="M9 10h3" />
        </svg>
        <span className="flex-1 text-left">New Terminal</span>
        <Kbd>⌘T</Kbd>
      </Button>

      <Button
        variant="ghost"
        onPress={() => toggleSidebar()}
        className="w-80 justify-start gap-3 px-4 py-2.5 text-lg"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <rect x="1" y="1" width="14" height="14" rx="2" />
          <path d="M6 1v14" />
        </svg>
        <span className="flex-1 text-left">Toggle Sidebar</span>
        <Kbd>⌘B</Kbd>
      </Button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/workspaces/$workspaceId')({
  component: WorkspaceRoute,
});
