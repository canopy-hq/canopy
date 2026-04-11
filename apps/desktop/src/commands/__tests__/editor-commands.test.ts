import { describe, it, expect, vi } from 'vitest';

import { buildEditorCommands } from '../editor-commands';

import type { DetectedEditor } from '../../lib/editor';

vi.mock('../../lib/editor', () => ({
  DEFAULT_EDITOR_SETTING_KEY: 'defaultEditor',
  openInEditor: vi.fn(() => Promise.resolve()),
  resolveDefaultEditor: vi.fn(
    (editors: DetectedEditor[], settingValue: string) =>
      editors.find((e) => e.id === settingValue) ?? editors[0],
  ),
}));

vi.mock('../../lib/tab-actions', () => ({
  resolveProjectItemCwd: vi.fn((id: string) =>
    id === 'proj1-branch-main' ? '/path/to/project' : undefined,
  ),
}));

vi.mock('../../lib/toast', () => ({ showErrorToast: vi.fn() }));

vi.mock('@canopy/db', () => ({
  getSetting: vi.fn((_settings: unknown[], _key: string, fallback: string) => fallback),
}));

describe('buildEditorCommands', () => {
  const editors: DetectedEditor[] = [
    { id: 'cursor', displayName: 'Cursor', cliPath: '/usr/bin/cursor' },
    { id: 'vscode', displayName: 'VS Code', cliPath: '/usr/bin/code' },
  ];

  it('returns empty array when no editors detected', () => {
    const result = buildEditorCommands([], [], 'proj1-branch-main', 'proj1');
    expect(result).toEqual([]);
  });

  it('returns empty array when no active context', () => {
    const result = buildEditorCommands(editors, [], null, null);
    expect(result).toEqual([]);
  });

  it('returns a command with label "Open in editor" when editors available', () => {
    const result = buildEditorCommands(editors, [], 'proj1-branch-main', 'proj1');
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Open in editor');
    expect(result[0]!.category).toBe('action');
    expect(result[0]!.shortcut).toBe('⌘⇧E');
    expect(result[0]!.icon).toBe('editor');
  });

  it('command action calls openInEditor with resolved CWD', async () => {
    const { openInEditor } = await import('../../lib/editor');
    const result = buildEditorCommands(editors, [], 'proj1-branch-main', 'proj1');
    const cmd = result[0]!;
    void cmd.action!({ close: vi.fn() });
    expect(openInEditor).toHaveBeenCalledWith('cursor', '/path/to/project');
  });
});
