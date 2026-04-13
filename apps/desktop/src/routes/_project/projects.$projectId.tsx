import { useEffect } from 'react';

import { ActionRow, Spinner } from '@canopy/ui';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal } from 'lucide-react';
import * as v from 'valibot';

import { ClaudeCodeIcon } from '../../components/ClaudeCodeIcon';
import { ClaudeCodeSetupDialog } from '../../components/ClaudeCodeSetupDialog';
import { TabBar } from '../../components/TabBar';
import { useUiState, useTabs } from '../../hooks/useCollections';
import {
  toggleSidebar,
  setPendingClaudeSession,
  cancelPendingClaudeSession,
} from '../../lib/project-actions';
import { addTab, addClaudeCodeTab, activateContextFromRoute } from '../../lib/tab-actions';
import { router } from '../../router';

function CreatingWorktree() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Spinner size={16} className="text-fg-faint" />
      <span className="font-mono text-sm text-fg-faint">Creating worktree…</span>
    </div>
  );
}

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const { setup } = Route.useSearch();
  const navigate = Route.useNavigate();
  const location = useLocation();
  const ui = useUiState();
  const allTabs = useTabs();

  const contextTabs = allTabs.filter((t) => t.projectItemId === projectId);
  const isCreating = ui.creatingWorktreeIds.includes(projectId);
  const worktreeName = projectId.includes('-wt-') ? (projectId.split('-wt-').pop() ?? '') : '';

  // Keep activeContextId in sync with the URL whenever projectId changes.
  // activateTabFromRoute (TabRoute) is the authoritative writer when tabs exist —
  // React runs child effects before parent, so it always wins and the guard inside
  // activateContextFromRoute prevents a double-write. For the EmptyState case
  // (no TabRoute), this is the only place that updates activeContextId.
  useEffect(() => {
    activateContextFromRoute(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Safety net: if we land on the bare project URL (no /tabs/ segment) but tabs exist,
  // redirect to the saved tab. Covers crash recovery and stale boot state.
  // Skip when we're already on a tab sub-route — the tab route's useEffect handles
  // activation there, and this effect's stale closure would redirect to the wrong tab.
  useEffect(() => {
    if (router.state.location.pathname.includes('/tabs/')) return;
    if (contextTabs.length === 0) return;
    const savedTabId = ui.contextActiveTabIds[projectId];
    const savedTab = savedTabId ? contextTabs.find((t) => t.id === savedTabId) : undefined;
    const tab = savedTab ?? contextTabs[0]!;
    void router.navigate({
      to: '/projects/$projectId/tabs/$tabId',
      params: { projectId, tabId: tab.id },
      replace: true,
      state: { skipNav: true },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const clearSetup = () => void navigate({ search: (prev) => ({ ...prev, setup: undefined }) });

  // Only show the tab bar once the URL has committed to a tab sub-route.
  // insertTab fires before navigateToTab, so without this guard a render frame would
  // show the tab bar (40 px) while the content area still shows EmptyState — a layout shift.
  const showTabBar = location.pathname.includes('/tabs/');

  return (
    <>
      {showTabBar && <TabBar projectId={projectId} />}
      <div className="relative min-h-0 flex-1">
        {isCreating ? (
          <CreatingWorktree />
        ) : contextTabs.length === 0 ? (
          <EmptyState projectId={projectId} />
        ) : (
          <Outlet />
        )}
        {setup && (
          <ClaudeCodeSetupDialog
            worktreeName={worktreeName}
            onLaunch={(mode, prompt) => {
              if (isCreating) {
                setPendingClaudeSession(projectId, mode, prompt);
                clearSetup();
              } else {
                addClaudeCodeTab(projectId, { mode, prompt });
              }
            }}
            onSkip={() => {
              cancelPendingClaudeSession();
              clearSetup();
            }}
          />
        )}
      </div>
    </>
  );
}

function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 select-none">
      <ActionRow
        icon={<ClaudeCodeIcon size={15} className="text-claude" />}
        label="Claude Code"
        onPress={() => addClaudeCodeTab(projectId)}
      />
      <ActionRow
        icon={<SquareTerminal size={15} />}
        label="New terminal"
        shortcut="⌘T"
        onPress={() => addTab(projectId)}
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

const projectSearchSchema = v.object({
  setup: v.fallback(v.optional(v.literal(true as const)), undefined),
});

export const Route = createFileRoute('/_project/projects/$projectId')({
  component: ProjectRoute,
  validateSearch: projectSearchSchema,
});
