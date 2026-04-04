import { getSetting } from '@superagent/db';

import { selectWorkspaceItem } from '../lib/workspace-actions';

import type { CommandItem } from '@superagent/command-palette';
import type { Setting, Workspace } from '@superagent/db';

type Nav = (opts: { to: string; params?: Record<string, string> }) => void;

export function buildWorkspaceCommands(
  workspaces: Workspace[],
  settings: Setting[],
  navigate: Nav,
): CommandItem[] {
  const recentIds = getSetting<string[]>(settings, 'recentWorkspaceIds', []);

  // Sort: recent workspaces first (by recency), then by position
  const sorted = [...workspaces].sort((a, b) => {
    const ai = recentIds.indexOf(a.id);
    const bi = recentIds.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.position - b.position;
  });

  return sorted.map((ws): CommandItem => {
    const headBranch = ws.branches.find((b) => b.is_head) ?? ws.branches[0];

    return {
      id: `workspace:${ws.id}`,
      label: ws.name,
      category: 'workspace',
      keywords: [ws.path, 'project', 'repo', 'repository'],
      icon: 'folder',
      children: () => buildWorkspaceChildren(ws, navigate),
      action: ({ close }) => {
        if (headBranch) {
          selectWorkspaceItem(`${ws.id}-branch-${headBranch.name}`, navigate);
        }
        close();
      },
    };
  });
}

function buildWorkspaceChildren(ws: Workspace, navigate: Nav): CommandItem[] {
  const items: CommandItem[] = [];

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
