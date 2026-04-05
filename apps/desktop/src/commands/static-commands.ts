import { openImportDialog, toggleSidebar } from '../lib/workspace-actions';

import type { Nav, CommandItem } from '@superagent/command-palette';

export function buildStaticCommands(navigate: Nav): CommandItem[] {
  return [
    {
      id: 'action:add-project',
      label: 'Add Project',
      category: 'global',
      keywords: ['import', 'repository', 'repo', 'open', 'folder'],
      icon: 'folder',
      shortcut: '⌘N',
      action: async ({ close }) => {
        close();
        await openImportDialog();
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
        navigate({ to: '/settings', search: { section: 'appearance' } });
        close();
      },
    },
  ];
}
