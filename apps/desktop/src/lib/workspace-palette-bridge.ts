import type { CommandItem } from '@superagent/command-palette';

// Single-subscriber bridge — only __root.tsx ever registers.
type Handler = (item: CommandItem) => void;
let _handler: Handler | null = null;

export function onOpenWorkspacePalette(handler: Handler): () => void {
  _handler = handler;
  return () => {
    _handler = null;
  };
}

export function openWorkspacePalette(item: CommandItem): void {
  _handler?.(item);
}
