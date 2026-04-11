import { openAddProjectDialog, toggleSidebar } from '../lib/project-actions';

import type { Nav, CommandItem } from '@canopy/command-palette';

export function buildStaticCommands(navigate: Nav): CommandItem[] {
  return [
    {
      id: 'action:add-project',
      label: 'Add project',
      category: 'global',
      keywords: ['import', 'repository', 'repo', 'open', 'folder'],
      icon: 'folder',
      shortcut: '⌘N',
      action: ({ close }) => {
        close();
        openAddProjectDialog();
      },
    },
    {
      id: 'action:toggle-sidebar',
      label: 'Toggle sidebar',
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
      label: 'Open settings',
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
