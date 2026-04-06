import type { CommandItem } from '@superagent/command-palette';

// Single-subscriber bridge — only __root.tsx ever registers.
type Handler = (item: CommandItem) => void;
let _handler: Handler | null = null;

export function onOpenProjectPalette(handler: Handler): () => void {
  if (import.meta.env.DEV && _handler) {
    console.warn('onOpenProjectPalette: replacing an existing handler — double mount?');
  }
  _handler = handler;
  return () => {
    _handler = null;
  };
}

export function openProjectPalette(item: CommandItem): void {
  _handler?.(item);
}
