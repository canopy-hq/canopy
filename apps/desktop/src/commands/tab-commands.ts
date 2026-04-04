import { jumpToPane } from '../lib/tab-actions';

import type { CommandItem } from '@superagent/command-palette';
import type { Tab, UiState, Workspace } from '@superagent/db';

type Nav = (opts: { to: string; params?: Record<string, string> }) => void;

export function buildTabCommands(
  tabs: Tab[],
  uiState: UiState,
  navigate: Nav,
  workspaces: Workspace[],
): CommandItem[] {
  // Current context tabs first, then sorted by position
  const sorted = [...tabs].sort((a, b) => {
    const aIsCurrent = a.workspaceItemId === uiState.activeContextId;
    const bIsCurrent = b.workspaceItemId === uiState.activeContextId;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return a.position - b.position;
  });

  return sorted.map((tab): CommandItem => {
    const ws = workspaces.find((w) => tab.workspaceItemId.startsWith(w.id));
    return {
      id: `tab:${tab.id}`,
      label: tab.label,
      category: 'tab',
      keywords: ['terminal', 'switch', 'pane'],
      icon: 'tab',
      group: ws?.name,
      contextId: tab.workspaceItemId,
      action: ({ close }) => {
        jumpToPane(navigate, tab.workspaceItemId, tab.id);
        close();
      },
    };
  });
}
