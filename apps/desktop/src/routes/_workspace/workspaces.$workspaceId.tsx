import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { setActiveContext, addTab } from '../../lib/tab-actions';
import { toggleSidebar } from '../../lib/workspace-actions';

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

  return (
    <>
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {activeTab ? (
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

function KbdBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex min-w-[22px] items-center justify-center rounded-[5px] border border-border bg-bg-tertiary px-[5px] text-[12px] leading-[22px] text-text-muted">
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-1 select-none">
      <div className="mb-8 font-mono text-[42px] font-semibold tracking-[-2px] text-text-muted opacity-25">
        {'{ }'}
      </div>

      <button
        onClick={addTab}
        className="flex w-80 cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
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
        <div className="flex gap-1">
          <KbdBadge>⌘</KbdBadge>
          <KbdBadge>T</KbdBadge>
        </div>
      </button>

      <button
        onClick={() => toggleSidebar()}
        className="flex w-80 cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
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
        <div className="flex gap-1">
          <KbdBadge>⌘</KbdBadge>
          <KbdBadge>B</KbdBadge>
        </div>
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/workspaces/$workspaceId')({
  component: WorkspaceRoute,
});
