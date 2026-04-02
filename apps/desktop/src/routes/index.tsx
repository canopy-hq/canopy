import { createFileRoute } from '@tanstack/react-router';
import { TabBar } from '../components/TabBar';
import { PaneContainer } from '../components/PaneContainer';
import { useUiState, useTabs } from '../hooks/useCollections';
import { toggleSidebar } from '../lib/workspace-actions';

function IndexRoute() {
  const ui = useUiState();
  const allTabs = useTabs();
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);
  const hasContext = ui.activeContextId !== '';
  const contextTabs = allTabs.filter((t) => t.workspaceItemId === ui.activeContextId);
  const hasTabs = contextTabs.length > 0;

  if (!hasContext) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <span className="text-lg font-semibold text-text-primary">No workspace selected</span>
        <span className="text-sm text-center max-w-[280px]">
          Import a git repository and select a branch or worktree to start working.
        </span>
        <button
          className="mt-2 px-4 h-8 bg-bg-tertiary text-text-muted hover:text-[var(--accent)] cursor-pointer"
          style={{ fontSize: '13px', borderRadius: '4px' }}
          onClick={() => toggleSidebar()}
        >
          Open Sidebar (⌘B)
        </button>
      </div>
    );
  }

  if (!hasTabs) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span className="text-sm">
          Open a terminal{' '}
          <kbd className="px-1.5 py-0.5 text-xs rounded bg-bg-tertiary text-text-secondary border border-border">
            ⌘T
          </kbd>
        </span>
      </div>
    );
  }

  return (
    <>
      <TabBar />
      <div className="flex-1 min-h-0 relative">
        {activeTab && (
          <div key={activeTab.id} className="absolute inset-0">
            <PaneContainer root={activeTab.paneRoot} />
          </div>
        )}
      </div>
    </>
  );
}

export const Route = createFileRoute('/')({
  component: IndexRoute,
});
