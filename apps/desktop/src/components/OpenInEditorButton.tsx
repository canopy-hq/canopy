import { useCallback } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';

import { getSetting, setSetting } from '@superagent/db';
import { Button, Tooltip } from '@superagent/ui';
import { ChevronDown } from 'lucide-react';

import { useSettings, useUiState } from '../hooks/useCollections';
import { openInEditor, useDetectedEditors, type DetectedEditor } from '../lib/editor';
import { resolveProjectItemCwd } from '../lib/tab-actions';
import { showErrorToast } from '../lib/toast';

const SETTING_KEY = 'defaultEditor';

const panelCls =
  'w-max rounded-lg border border-border/60 bg-bg-secondary py-1 shadow-lg outline-none';
const itemCls =
  'flex cursor-default items-center gap-2 px-3 py-1.5 text-base text-text-secondary outline-none data-[focused]:bg-bg-tertiary';

function resolveDefault(
  editors: DetectedEditor[],
  settingValue: string,
): DetectedEditor | undefined {
  if (editors.length === 0) return undefined;
  return editors.find((e) => e.id === settingValue) ?? editors[0];
}

/**
 * Header button — opens active project/worktree in editor.
 * Reads activeContextId from UI state so it works without props.
 * Renders icon-only for 1 editor, split icon+chevron for 2+.
 */
export function OpenInEditorButton() {
  const editors = useDetectedEditors();
  const settings = useSettings();
  const ui = useUiState();
  const projectItemId = ui.activeContextId;
  const defaultEditorId = getSetting<string>(settings, SETTING_KEY, '');
  const defaultEditor = resolveDefault(editors, defaultEditorId);

  const handleOpen = useCallback(
    (editor: DetectedEditor) => {
      if (!projectItemId) return;
      const cwd = resolveProjectItemCwd(projectItemId);
      if (!cwd) return;
      openInEditor(editor.id, cwd).catch((err) => {
        showErrorToast('Failed to open editor', String(err));
      });
    },
    [projectItemId],
  );

  const handleSelect = useCallback(
    (editorId: string) => {
      const editor = editors.find((e) => e.id === editorId);
      if (!editor) return;
      setSetting(SETTING_KEY, editor.id);
    },
    [editors],
  );

  if (!defaultEditor || !projectItemId) return null;

  const label = `Open in ${defaultEditor.displayName}`;

  // Single editor — text button, no dropdown
  if (editors.length === 1) {
    return (
      <Tooltip label={label} placement="left">
        <Button
          variant="ghost"
          onPress={() => handleOpen(defaultEditor)}
          aria-label={label}
          className="h-7 px-2 text-xs font-medium text-text-secondary"
        >
          {label}
        </Button>
      </Tooltip>
    );
  }

  // Multiple editors — text button + chevron dropdown
  return (
    <div className="inline-flex items-center">
      <Tooltip label={label} placement="left">
        <Button
          variant="ghost"
          onPress={() => handleOpen(defaultEditor)}
          aria-label={label}
          className="h-7 rounded-r-none px-2 text-xs font-medium text-text-secondary"
        >
          {label}
        </Button>
      </Tooltip>
      <MenuTrigger>
        <Button
          variant="ghost"
          aria-label="Choose editor"
          className="h-7 w-5 rounded-l-none border-l border-border/30 p-0 text-text-faint"
        >
          <ChevronDown size={10} />
        </Button>
        <Popover placement="bottom end" className={panelCls}>
          <Menu className="outline-none" onAction={(key) => handleSelect(String(key))}>
            {editors.map((editor) => (
              <MenuItem key={editor.id} id={editor.id} className={itemCls}>
                <span className="flex-1">{editor.displayName}</span>
                {editor.id === defaultEditor.id && (
                  <span className="ml-auto text-[10px] text-text-faint">✓</span>
                )}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}

/** Hook for use in EmptyState ActionRow — returns { label, onPress } or null. */
export function useOpenInEditor(projectItemId: string) {
  const editors = useDetectedEditors();
  const settings = useSettings();
  const defaultEditorId = getSetting<string>(settings, SETTING_KEY, '');
  const defaultEditor = resolveDefault(editors, defaultEditorId);

  const onPress = useCallback(() => {
    if (!defaultEditor) return;
    const cwd = resolveProjectItemCwd(projectItemId);
    if (!cwd) return;
    openInEditor(defaultEditor.id, cwd).catch((err) => {
      showErrorToast('Failed to open editor', String(err));
    });
  }, [defaultEditor, projectItemId]);

  if (!defaultEditor) return null;

  return { label: `Open in ${defaultEditor.displayName}`, onPress };
}
