import { createElement } from 'react';

import { getSetting } from '@superagent/db';

import { ProjectPalettePanel } from '../components/ProjectPalette';
import { selectProjectItem } from '../lib/project-actions';
import { addTab } from '../lib/tab-actions';

import type { Nav, CommandItem, PanelContext } from '@superagent/command-palette';
import type { Setting, Project } from '@superagent/db';

export function makeProjectPaletteItem(proj: Project): CommandItem {
  return {
    id: `project:${proj.id}:palette`,
    label: 'New worktree',
    category: 'action',
    icon: 'plus',
    keywords: ['worktree', 'create', 'new', proj.name],
    contextId: proj.id,
    renderPanel: (ctx: PanelContext) => createElement(ProjectPalettePanel, { project: proj, ctx }),
  };
}

export function buildProjectCommands(
  projects: Project[],
  settings: Setting[],
  navigate: Nav,
  activeContextId?: string | null,
): CommandItem[] {
  const recentIds = getSetting<string[]>(settings, 'recentProjectIds', []);

  const sorted = [...projects].sort((a, b) => {
    const ai = recentIds.indexOf(a.id);
    const bi = recentIds.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.position - b.position;
  });

  const items: CommandItem[] = sorted.map((proj): CommandItem => {
    const headBranch = proj.branches.find((b) => b.is_head) ?? proj.branches[0];

    return {
      id: `project:${proj.id}`,
      label: proj.name,
      category: 'project',
      keywords: [proj.path, 'project', 'repo', 'repository'],
      icon: 'folder',
      children: () => buildProjectChildren(proj, navigate),
      action: ({ close }) => {
        if (headBranch) selectProjectItem(`${proj.id}-branch-${headBranch.name}`, navigate);
        close();
      },
    };
  });

  // Add quick actions for the active project (shown as a dedicated top section).
  // activeContextId is a projectItemId like `${projId}-branch-main`, so match by prefix.
  const activeProj = activeContextId
    ? projects.find((proj) => activeContextId.startsWith(proj.id))
    : null;
  if (activeProj) {
    items.push({
      id: `project:${activeProj.id}:new-tab`,
      label: 'New tab',
      category: 'action',
      icon: 'tab',
      shortcut: '⌘T',
      keywords: ['tab', 'terminal', 'open', 'new', activeProj.name],
      contextId: activeProj.id,
      action: ({ close }) => {
        addTab();
        close();
      },
    });
    items.push(makeProjectPaletteItem(activeProj));
  }

  return items;
}

function buildProjectChildren(proj: Project, navigate: Nav): CommandItem[] {
  const items: CommandItem[] = [];

  // Palette item first
  items.push(makeProjectPaletteItem(proj));

  // HEAD branch first
  const branches = [...proj.branches].sort((a, b) => (b.is_head ? 1 : 0) - (a.is_head ? 1 : 0));

  for (const branch of branches) {
    const itemId = `${proj.id}-branch-${branch.name}`;
    items.push({
      id: `nav:${itemId}`,
      label: `${branch.name}${branch.is_head ? ' (HEAD)' : ''}`,
      category: 'project',
      keywords: ['branch', 'checkout', branch.name],
      icon: 'branch',
      action: ({ close }) => {
        selectProjectItem(itemId, navigate);
        close();
      },
    });
  }

  for (const wt of proj.worktrees) {
    const itemId = `${proj.id}-wt-${wt.name}`;
    items.push({
      id: `nav:${itemId}`,
      label: wt.label ?? wt.name,
      category: 'project',
      keywords: ['worktree', wt.branch, wt.name],
      icon: 'worktree',
      action: ({ close }) => {
        selectProjectItem(itemId, navigate);
        close();
      },
    });
  }

  return items;
}
