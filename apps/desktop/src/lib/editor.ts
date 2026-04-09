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

export function useDetectedEditors(): DetectedEditor[] {
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  useEffect(() => {
    detectEditors()
      .then(setEditors)
      .catch(() => {});
  }, []);

  return editors;
}
