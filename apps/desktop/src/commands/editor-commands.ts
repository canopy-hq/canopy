import { getSetting } from '@superagent/db';

import { openInEditor } from '../lib/editor';
import { resolveProjectItemCwd } from '../lib/tab-actions';
import { showErrorToast } from '../lib/toast';

import type { DetectedEditor } from '../lib/editor';
import type { CommandItem } from '@superagent/command-palette';
import type { Setting } from '@superagent/db';

const SETTING_KEY = 'defaultEditor';

export function buildEditorCommands(
  editors: DetectedEditor[],
  settings: Setting[],
  activeContextId: string | null | undefined,
): CommandItem[] {
  if (editors.length === 0 || !activeContextId) return [];

  const defaultEditorId = getSetting<string>(settings, SETTING_KEY, '');
  const defaultEditor = editors.find((e) => e.id === defaultEditorId) ?? editors[0]!;

  return [
    {
      id: 'action:open-in-editor',
      label: 'Open in editor',
      category: 'action',
      icon: 'editor',
      shortcut: '⌘⇧E',
      keywords: ['editor', 'code', 'vscode', 'cursor', 'zed', 'open', 'ide'],
      contextId: activeContextId.split('-')[0],
      action: ({ close }) => {
        const cwd = resolveProjectItemCwd(activeContextId);
        if (!cwd) {
          showErrorToast('No project path', 'Could not resolve project directory');
          return;
        }
        openInEditor(defaultEditor.id, cwd).catch((err) => {
          showErrorToast('Failed to open editor', String(err));
        });
        close();
      },
    },
  ];
}
