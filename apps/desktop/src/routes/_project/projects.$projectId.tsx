import { useEffect, useState } from 'react';

import { ActionRow, Spinner } from '@canopy/ui';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { Check, PanelLeft, SquareTerminal } from 'lucide-react';
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

type StepState = 'pending' | 'active' | 'done';

function StepRow({ label, state }: { label: string; state: StepState }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-sm">
      {state === 'done' ? (
        <Check size={12} className="shrink-0 text-fg-muted" />
      ) : state === 'active' ? (
        <Spinner size={12} className="shrink-0 text-fg-muted" />
      ) : (
        <div className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-fg-faint" />
      )}
      <span className={state === 'pending' ? 'text-fg-faint' : 'text-fg-muted'}>{label}</span>
    </div>
  );
}

function CreatingWorktree({
  claudePending,
  claudeMode,
  claudePrompt,
  onCancelClaude,
}: {
  claudePending: boolean;
  claudeMode?: 'bypass' | 'plan';
  claudePrompt?: string;
  onCancelClaude: () => void;
}) {
  // Simulate step 0 ("Preparing") completing quickly so the UI shows momentum.
  // Step 1 ("Creating worktree") stays active for the duration of the real async op.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setStep(1), 600);
    return () => clearTimeout(t);
  }, []);

  const steps: Array<{ label: string; state: StepState }> = [
    { label: 'Preparing workspace', state: step > 0 ? 'done' : 'active' },
    {
      label: 'Creating git worktree',
      state: step > 1 ? 'done' : step === 1 ? 'active' : 'pending',
    },
    ...(claudePending ? [{ label: 'Launching Claude Code', state: 'pending' as StepState }] : []),
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 select-none">
      <div className="flex flex-col gap-2">
        {steps.map((s) => (
          <StepRow key={s.label} label={s.label} state={s.state} />
        ))}
      </div>
      {claudePending && (
        <div className="flex flex-col items-center gap-1 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-fg-muted">
            <ClaudeCodeIcon size={11} className="text-claude" />
            <span>Claude Code will launch automatically</span>
            <span className="text-fg-faint">·</span>
            <button
              type="button"
              onClick={onCancelClaude}
              className="text-fg-faint transition-colors hover:text-fg"
            >
              Cancel
            </button>
          </div>
          {claudeMode && (
            <div className="flex items-center gap-1.5 text-fg-faint">
              <span>{claudeMode === 'plan' ? 'Plan mode' : 'Bypass permissions'}</span>
              {claudePrompt && (
                <>
                  <span>·</span>
                  <span className="max-w-xs truncate">"{claudePrompt}"</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
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
  const hasPendingClaude =
    !!ui.pendingClaudeSession && ui.pendingClaudeSession.worktreeId === projectId;
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
          <CreatingWorktree
            claudePending={hasPendingClaude}
            claudeMode={ui.pendingClaudeSession?.mode}
            claudePrompt={ui.pendingClaudeSession?.prompt}
            onCancelClaude={cancelPendingClaudeSession}
          />
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
