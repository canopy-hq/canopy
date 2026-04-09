import { useEffect } from 'react';

import { ActionRow, Button, Spinner } from '@superagent/ui';
import { createFileRoute } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal, X } from 'lucide-react';

import { ClaudeCodeIcon } from '../../components/ClaudeCodeIcon';
import { ClaudeCodeSetupDialog } from '../../components/ClaudeCodeSetupDialog';
import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { useUiState, useTabs } from '../../hooks/useCollections';
import {
  toggleSidebar,
  clearJustStartedWorktree,
  setPendingClaudeSession,
  cancelPendingClaudeSession,
} from '../../lib/project-actions';
import { setActiveContext, addTab, addClaudeCodeTab } from '../../lib/tab-actions';

function CreatingWorktree({
  pendingSession,
}: {
  pendingSession: { mode: 'bypass' | 'plan'; prompt?: string } | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Spinner size={16} className="text-text-faint" />
      <span className="font-mono text-sm text-text-faint">Creating worktree…</span>
      {pendingSession && (
        <div className="mt-1 flex w-72 flex-col gap-2">
          <div className="flex flex-col gap-1.5 rounded-md border border-border/30 bg-bg-secondary px-3 py-2 font-mono text-xs text-text-muted">
            <div className="flex items-center justify-center gap-1.5">
              <ClaudeCodeIcon size={12} className="shrink-0 text-[#da7756]" />
              <span>
                Claude Code ·{' '}
                <span className="text-text-secondary">
                  {pendingSession.mode === 'plan' ? 'plan mode' : 'bypass permissions'}
                </span>
              </span>
            </div>
            {pendingSession.prompt && (
              <p className="leading-relaxed break-words whitespace-pre-wrap text-text-faint">
                "{pendingSession.prompt}"
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onPress={cancelPendingClaudeSession}
            className="flex w-fit items-center gap-1 self-center text-xs text-text-faint hover:text-text-muted"
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
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);
  // Sync store state when navigating to a project URL directly (routing is source of truth)
  useEffect(() => {
    if (ui.activeContextId !== projectId) {
      setActiveContext(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isCreating = ui.creatingWorktreeIds.includes(projectId);
  const showSetupDialog = ui.justStartedWorktreeId === projectId;
  const worktreeName = projectId.includes('-wt-') ? (projectId.split('-wt-').pop() ?? '') : '';

  // Pending session relevant to this worktree (shown on loading screen)
  const pendingSession =
    ui.pendingClaudeSession?.worktreeId === projectId ? ui.pendingClaudeSession : null;

  return (
    <>
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {isCreating ? (
          <CreatingWorktree pendingSession={pendingSession} />
        ) : activeTab ? (
          <div key={activeTab.id} className="absolute inset-0">
            <PaneContainer root={activeTab.paneRoot} />
          </div>
        ) : (
          <EmptyState projectId={projectId} />
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
        icon={<ClaudeCodeIcon size={15} className="text-[#da7756]" />}
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
