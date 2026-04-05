import { createElement } from 'react';

import { getSetting } from '@superagent/db';

import { WorkspacePalettePanel } from '../components/WorkspacePalette';
import { addTab } from '../lib/tab-actions';
import { selectWorkspaceItem } from '../lib/workspace-actions';

import type { Nav, CommandItem } from '@superagent/command-palette';
import type { Setting, Workspace } from '@superagent/db';

export function makeWorkspacePaletteItem(ws: Workspace): CommandItem {
  return {
    id: `workspace:${ws.id}:palette`,
    label: 'New branch or worktree',
    category: 'action',
    icon: 'plus',
    keywords: ['branch', 'worktree', 'create', 'new', ws.name],
    contextId: ws.id,
    renderPanel: (ctx: PanelContext) =>
      createElement(WorkspacePalettePanel, { workspace: ws, ctx }),
  };
}

export function buildWorkspaceCommands(
  workspaces: Workspace[],
  settings: Setting[],
  navigate: Nav,
  activeContextId?: string | null,
): CommandItem[] {
  const recentIds = getSetting<string[]>(settings, 'recentWorkspaceIds', []);

  const sorted = [...workspaces].sort((a, b) => {
    const ai = recentIds.indexOf(a.id);
    const bi = recentIds.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.position - b.position;
  });

  const items: CommandItem[] = sorted.map((ws): CommandItem => {
    const headBranch = ws.branches.find((b) => b.is_head) ?? ws.branches[0];

    return {
      id: `workspace:${ws.id}`,
      label: ws.name,
      category: 'workspace',
      keywords: [ws.path, 'project', 'repo', 'repository'],
      icon: 'folder',
      children: () => buildWorkspaceChildren(ws, navigate),
      action: ({ close }) => {
        if (headBranch) selectWorkspaceItem(`${ws.id}-branch-${headBranch.name}`, navigate);
        close();
      },
    };
  });

  // Add quick actions for the active workspace (shown as a dedicated top section).
  // activeContextId is a workspaceItemId like `${wsId}-branch-main`, so match by prefix.
  const activeWs = activeContextId
    ? workspaces.find((ws) => activeContextId.startsWith(ws.id))
    : null;
  if (activeWs) {
    items.push({
      id: `workspace:${activeWs.id}:new-tab`,
      label: 'New Tab',
      category: 'action',
      icon: 'tab',
      shortcut: '⌘T',
      keywords: ['tab', 'terminal', 'open', 'new', activeWs.name],
      contextId: activeWs.id,
      action: ({ close }) => {
        addTab();
        close();
      },
    });
    items.push(makeWorkspacePaletteItem(activeWs));
  }

  return items;
}

function buildWorkspaceChildren(ws: Workspace, navigate: Nav): CommandItem[] {
  const items: CommandItem[] = [];

  // Palette item first
  items.push(makeWorkspacePaletteItem(ws));

  // HEAD branch first
  const branches = [...ws.branches].sort((a, b) => (b.is_head ? 1 : 0) - (a.is_head ? 1 : 0));

  for (const branch of branches) {
    const itemId = `${ws.id}-branch-${branch.name}`;
    items.push({
      id: `nav:${itemId}`,
      label: `${branch.name}${branch.is_head ? ' (HEAD)' : ''}`,
      category: 'workspace',
      keywords: ['branch', 'checkout', branch.name],
      icon: 'branch',
      action: ({ close }) => {
        selectWorkspaceItem(itemId, navigate);
        close();
      },
    });
  }

  for (const wt of ws.worktrees) {
    const itemId = `${ws.id}-wt-${wt.name}`;
    items.push({
      id: `nav:${itemId}`,
      label: wt.label ?? wt.name,
      category: 'workspace',
      keywords: ['worktree', wt.branch, wt.name],
      icon: 'worktree',
      action: ({ close }) => {
        selectWorkspaceItem(itemId, navigate);
        close();
      },
    });
  }

  return items;
}
