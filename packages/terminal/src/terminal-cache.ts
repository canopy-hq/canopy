import { Terminal, FitAddon } from 'ghostty-web';

export interface CachedEntry {
  term: Terminal;
  fitAddon: FitAddon;
  /** Stored for fresh spawns: called when the shell's readline is ready. */
  openGate?: () => void;
}

const cache = new Map<number, CachedEntry>();

export function getCached(ptyId: number): CachedEntry | undefined {
  return cache.get(ptyId);
}

export function setCached(
  ptyId: number,
  term: Terminal,
  fitAddon: FitAddon,
  openGate?: () => void,
): void {
  cache.set(ptyId, { term, fitAddon, openGate });
}

export function disposeCached(ptyId: number): void {
  const entry = cache.get(ptyId);
  if (entry) {
    entry.term.dispose();
    cache.delete(ptyId);
  }
}

export function getAllCached(): Map<number, CachedEntry> {
  return cache;
}
