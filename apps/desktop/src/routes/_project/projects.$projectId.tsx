import { useEffect } from 'react';

import { ActionRow, Button, Spinner } from '@canopy/ui';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal, X } from 'lucide-react';

import { ClaudeCodeIcon } from '../../components/ClaudeCodeIcon';
import { ClaudeCodeSetupDialog } from '../../components/ClaudeCodeSetupDialog';
import { TabBar } from '../../components/TabBar';
import { useUiState, useTabs } from '../../hooks/useCollections';
import {
  toggleSidebar,
  clearJustStartedWorktree,
  setPendingClaudeSession,
  cancelPendingClaudeSession,
} from '../../lib/project-actions';
import { addTab, addClaudeCodeTab } from '../../lib/tab-actions';
import { router } from '../../router';

function CreatingWorktree({
  pendingSession,
}: {
  pendingSession: { mode: 'bypass' | 'plan'; prompt?: string } | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Spinner size={16} className="text-fg-faint" />
      <span className="font-mono text-sm text-fg-faint">Creating worktree…</span>
      {pendingSession && (
        <div className="mt-1 flex w-72 flex-col gap-2">
          <div className="flex flex-col gap-1.5 rounded-md border border-edge/30 bg-raised px-3 py-2 font-mono text-xs text-fg-muted">
            <div className="flex items-center justify-center gap-1.5">
              <ClaudeCodeIcon size={12} className="shrink-0 text-claude" />
              <span>
                Claude Code ·{' '}
                <span className="text-fg-dim">
                  {pendingSession.mode === 'plan' ? 'plan mode' : 'bypass permissions'}
                </span>
              </span>
            </div>
            {pendingSession.prompt && (
              <p className="leading-relaxed break-words whitespace-pre-wrap text-fg-faint">
                "{pendingSession.prompt}"
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onPress={cancelPendingClaudeSession}
            className="flex w-fit items-center gap-1 self-center text-xs text-fg-faint hover:text-fg-muted"
          >
            <X size={11} />
            Cancel launch
          </Button>
        </div>
      )}
    </div>
  );
}

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const ui = useUiState();
  const allTabs = useTabs();

  const contextTabs = allTabs.filter((t) => t.projectItemId === projectId);
  const isCreating = ui.creatingWorktreeIds.includes(projectId);
  const showSetupDialog = ui.justStartedWorktreeId === projectId;
  const worktreeName = projectId.includes('-wt-') ? (projectId.split('-wt-').pop() ?? '') : '';
  const pendingSession =
    ui.pendingClaudeSession?.worktreeId === projectId ? ui.pendingClaudeSession : null;

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <>
      <TabBar projectId={projectId} />
      <div className="relative min-h-0 flex-1">
        {isCreating ? (
          <CreatingWorktree pendingSession={pendingSession} />
        ) : contextTabs.length === 0 ? (
          <EmptyState projectId={projectId} />
        ) : (
          <Outlet />
        )}
        {showSetupDialog && (
          <ClaudeCodeSetupDialog
            worktreeName={worktreeName}
            onLaunch={(mode, prompt) => {
              clearJustStartedWorktree();
              setPendingClaudeSession(projectId, mode, prompt);
            }}
            onSkip={clearJustStartedWorktree}
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

export const Route = createFileRoute('/_project/projects/$projectId')({ component: ProjectRoute });
