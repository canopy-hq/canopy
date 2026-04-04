import { addTab } from '../lib/tab-actions';
import { importRepo, toggleSidebar } from '../lib/workspace-actions';

import type { Nav, CommandItem } from '@superagent/command-palette';
import type { UiState } from '@superagent/db';

export function buildStaticCommands(navigate: Nav, uiState: UiState): CommandItem[] {
  const inProject = !!uiState.activeContextId;
  const items: CommandItem[] = [];

  if (inProject) {
    items.push({
      id: 'action:new-tab',
      label: 'New Tab',
      category: 'action',
      keywords: ['terminal', 'open', 'create'],
      shortcut: '⌘T',
      icon: 'plus',
      action: ({ close }) => {
        addTab();
        close();
      },
    });
  }

  items.push(
    {
      id: 'action:add-project',
      label: 'Add Project',
      category: 'global',
      keywords: ['import', 'repository', 'repo', 'open', 'folder'],
      icon: 'folder',
      action: async ({ close }) => {
        close();
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Git Repository',
          });
          if (selected && typeof selected === 'string') await importRepo(selected);
        } catch {
          // Dialog not available in test/dev environments
        }
      },
    },
    {
      id: 'action:toggle-sidebar',
      label: 'Toggle Sidebar',
      category: 'global',
      keywords: ['show', 'hide', 'sidebar', 'panel'],
      shortcut: '⌘B',
      icon: 'sidebar',
      action: ({ close }) => {
        toggleSidebar();
        close();
      },
    },
    {
      id: 'action:settings',
      label: 'Open Settings',
      category: 'global',
      keywords: ['preferences', 'config', 'theme'],
      icon: 'settings',
      action: ({ close }) => {
        navigate({ to: '/settings' });
        close();
      },
    },
  );

  return items;
}
