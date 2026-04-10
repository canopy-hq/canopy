import { useEffect, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';

export interface DetectedEditor {
  id: string;
  displayName: string;
  cliPath: string;
}

export function detectEditors(): Promise<DetectedEditor[]> {
  return invoke<DetectedEditor[]>('detect_editors');
}

export function openInEditor(editorId: string, path: string): Promise<void> {
  return invoke<void>('open_in_editor', { editorId, path });
}

export const DEFAULT_EDITOR_SETTING_KEY = 'defaultEditor';

export function resolveDefaultEditor(
  editors: DetectedEditor[],
  settingValue: string,
): DetectedEditor | undefined {
  if (editors.length === 0) return undefined;
  return editors.find((e) => e.id === settingValue) ?? editors[0];
}

export function useDetectedEditors(): DetectedEditor[] {
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  useEffect(() => {
    detectEditors()
      .then(setEditors)
      .catch(() => {});
  }, []);

  return editors;
}
