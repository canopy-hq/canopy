import { containsPtyId } from '../lib/pane-tree-ops';
import { jumpToPane } from '../lib/tab-actions';
import { resolveProjectForTab } from './utils';

import type { Nav, CommandItem } from '@canopy/command-palette';
import type { Tab, Project } from '@canopy/db';
import type { PtySessionInfo } from '@canopy/terminal';

export function buildPtyCommands(
  sessions: PtySessionInfo[],
  tabs: Tab[],
  projects: Project[],
  navigate: Nav,
): CommandItem[] {
  return sessions.map((session): CommandItem => {
    const tab = tabs.find((t) => containsPtyId(t.paneRoot, session.ptyId));
    const proj = tab ? resolveProjectForTab(tab, projects) : undefined;

    const cpu = session.cpuPercent.toFixed(1);
    const mem =
      session.memoryMb >= 1024
        ? `${(session.memoryMb / 1024).toFixed(1)}GB`
        : `${Math.round(session.memoryMb)}MB`;
    const label = `PTY ${session.ptyId} — ${cpu}% CPU · ${mem}`;

    return {
      id: `pty:${session.ptyId}`,
      label,
      category: 'pty',
      keywords: ['pty', 'terminal', 'process', 'session'],
      icon: 'tab',
      group: proj?.name ?? 'Orphaned',
      action: ({ close }) => {
        if (tab) jumpToPane(navigate, tab.projectItemId, tab.id);
        close();
      },
    };
  });
}
