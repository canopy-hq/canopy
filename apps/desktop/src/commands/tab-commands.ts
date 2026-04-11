import { jumpToPane } from '../lib/tab-actions';
import { resolveProjectForTab } from './utils';

import type { Nav, CommandItem } from '@canopy/command-palette';
import type { Tab, UiState, Project } from '@canopy/db';

export function buildTabCommands(
  tabs: Tab[],
  uiState: UiState,
  navigate: Nav,
  projects: Project[],
): CommandItem[] {
  const sorted = [...tabs].sort((a, b) => {
    const aIsCurrent = a.projectItemId === uiState.activeContextId;
    const bIsCurrent = b.projectItemId === uiState.activeContextId;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return a.position - b.position;
  });

  return sorted.map((tab): CommandItem => {
    const proj = resolveProjectForTab(tab, projects);
    return {
      id: `tab:${tab.id}`,
      label: tab.label,
      category: 'tab',
      keywords: ['terminal', 'switch', 'pane'],
      icon: 'tab',
      group: proj?.name,
      contextId: tab.projectItemId,
      action: ({ close }) => {
        jumpToPane(navigate, tab.projectItemId, tab.id);
        close();
      },
    };
  });
}
