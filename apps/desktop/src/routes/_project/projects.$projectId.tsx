import { useEffect, useRef, useState } from 'react';
import { Menu, MenuItem, Popover } from 'react-aria-components';

import { createFileRoute } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal } from 'lucide-react';

import { ClaudeCodeIcon } from '../../components/ClaudeCodeIcon';
import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { ActionRow, Button, Spinner } from '../../components/ui';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { toggleSidebar } from '../../lib/project-actions';
import { setActiveContext, addTab, addClaudeCodeTab } from '../../lib/tab-actions';

const menuPanelCls =
  'w-max rounded-lg border border-border/60 bg-bg-secondary py-1 shadow-lg outline-none';
const menuItemCls =
  'flex cursor-default items-center gap-2 px-3 py-1.5 text-base text-text-secondary outline-none data-[focused]:bg-bg-tertiary';

function CreatingWorktree() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 select-none">
      <Spinner size={16} className="text-text-faint" />
      <span className="font-mono text-sm text-text-faint">Creating worktree…</span>
    </div>
  );
}

function QuickActionsBar({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/40 bg-bg-secondary px-2">
      <Button
        size="sm"
        variant="ghost"
        onPress={() => addTab(projectId)}
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-sm text-text-faint"
      >
        <SquareTerminal size={12} />
        New terminal
      </Button>
      <span className="mx-1 h-3.5 w-px bg-border/50" aria-hidden />
      <Button
        size="sm"
        variant="ghost"
        onPress={() => addClaudeCodeTab(projectId)}
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-sm text-text-faint"
      >
        <ClaudeCodeIcon size={12} className="text-[#da7756]" />
        Claude Code
      </Button>
    </div>
  );
}

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const ui = useUiState();
  const allTabs = useTabs();
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);
  const hasTabs = allTabs.some((t) => t.projectItemId === projectId);

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
      {hasTabs && <QuickActionsBar projectId={projectId} />}
      <div className="relative min-h-0 flex-1">
        {isCreating ? (
          <CreatingWorktree />
        ) : activeTab ? (
          <div key={activeTab.id} className="absolute inset-0">
            <PaneContainer root={activeTab.paneRoot} />
          </div>
        ) : (
          <EmptyState projectId={projectId} />
        )}
      </div>
    </>
  );
}

function EmptyState({ projectId }: { projectId: string }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 select-none">
      <div ref={triggerRef}>
        <ActionRow
          icon={<SquareTerminal size={15} />}
          label="New terminal"
          shortcut="⌘T"
          onPress={() => setMenuOpen(true)}
        />
      </div>
      <Popover
        triggerRef={triggerRef}
        isOpen={menuOpen}
        onOpenChange={(open) => {
          if (!open) setMenuOpen(false);
        }}
        placement="bottom start"
        className={menuPanelCls}
      >
        <Menu
          className="outline-none"
          onAction={(key) => {
            setMenuOpen(false);
            if (key === 'terminal') addTab(projectId);
            else if (key === 'claude-code') addClaudeCodeTab(projectId);
          }}
        >
          <MenuItem id="terminal" className={menuItemCls}>
            <SquareTerminal size={13} />
            Terminal
          </MenuItem>
          <MenuItem id="claude-code" className={menuItemCls}>
            <ClaudeCodeIcon size={13} className="text-[#da7756]" />
            Claude Code
          </MenuItem>
        </Menu>
      </Popover>
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
