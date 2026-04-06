import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal } from 'lucide-react';

import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { ActionRow, Spinner } from '../../components/ui';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { toggleSidebar } from '../../lib/project-actions';
import { setActiveContext, addTab } from '../../lib/tab-actions';

function CreatingWorktree() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Spinner size={16} className="text-text-faint" />
      <span className="font-mono text-sm text-text-faint">Creating worktree…</span>
    </div>
  );
}

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const ui = useUiState();
  const allTabs = useTabs();
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);

  // Sync store state when navigating to a project URL directly (routing is source of truth)
  useEffect(() => {
    if (ui.activeContextId !== projectId) {
      setActiveContext(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isCreating = ui.creatingWorktreeIds.includes(projectId);

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
      <ActionRow
        icon={<SquareTerminal size={15} />}
        label="New terminal"
        shortcut="⌘T"
        onPress={() => addTab()}
      />
      <ActionRow
        icon={<PanelLeft size={15} />}
        label="Toggle sidebar"
        shortcut="⌘B"
        onPress={() => toggleSidebar()}
      />
    </div>
  );
}

export const Route = createFileRoute('/_project/projects/$projectId')({ component: ProjectRoute });
