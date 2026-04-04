import { init } from 'ghostty-web';

let ready: Promise<void> | null = null;
let resolved = false;

export function ensureGhosttyInit(): Promise<void> {
  if (!ready) {
    ready = init().then(() => {
      resolved = true;
    });
  }
  return ready;
}

/** Synchronous check — true only after ensureGhosttyInit() has resolved. */
export function isGhosttyReady(): boolean {
  return resolved;
}
