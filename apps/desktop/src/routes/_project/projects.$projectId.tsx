import { useEffect } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';

import { createFileRoute } from '@tanstack/react-router';
import { PanelLeft, SquareTerminal } from 'lucide-react';

import { ClaudeCodeIcon } from '../../components/ClaudeCodeIcon';
import { PaneContainer } from '../../components/PaneContainer';
import { TabBar } from '../../components/TabBar';
import { ActionRow, Button, Kbd, Spinner } from '../../components/ui';
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

function QuickActionsBar() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border/40 bg-bg-secondary px-2">
      <Button
        size="sm"
        variant="ghost"
        onPress={() => addTab()}
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-sm text-text-faint"
      >
        <SquareTerminal size={12} />
        New terminal
      </Button>
      <span className="mx-1 h-3.5 w-px bg-border/50" aria-hidden />
      <Button
        size="sm"
        variant="ghost"
        onPress={() => addClaudeCodeTab()}
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
      <QuickActionsBar />
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
      <MenuTrigger>
        <Button
          variant="ghost"
          className="flex w-72 items-center gap-3 px-4 py-3 font-mono text-base text-text-faint hover:bg-white/[0.04] hover:text-text-muted"
        >
          <span className="shrink-0">
            <SquareTerminal size={15} />
          </span>
          <span className="flex-1 text-left">New terminal</span>
          <Kbd>⌘T</Kbd>
        </Button>
        <Popover placement="bottom start" className={menuPanelCls}>
          <Menu
            className="outline-none"
            onAction={(key) => {
              if (key === 'terminal') addTab();
              else if (key === 'claude-code') addClaudeCodeTab();
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
      </MenuTrigger>
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
