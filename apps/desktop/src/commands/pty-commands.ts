import { containsPtyId } from '../lib/pane-tree-ops';
import { jumpToPane } from '../lib/tab-actions';
import { resolveWorkspaceForTab } from './utils';

import type { Nav, CommandItem } from '@superagent/command-palette';
import type { Tab, Workspace } from '@superagent/db';
import type { PtySessionInfo } from '@superagent/terminal';

export function buildPtyCommands(
  sessions: PtySessionInfo[],
  tabs: Tab[],
  workspaces: Workspace[],
  navigate: Nav,
): CommandItem[] {
  return sessions.map((session): CommandItem => {
    const tab = tabs.find((t) => containsPtyId(t.paneRoot, session.ptyId));
    const ws = tab ? resolveWorkspaceForTab(tab, workspaces) : undefined;

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
      group: ws?.name ?? 'Orphaned',
      action: ({ close }) => {
        if (tab) jumpToPane(navigate, tab.workspaceItemId, tab.id);
        close();
      },
    };
  });
}
