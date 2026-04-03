import { init } from "ghostty-web";

let ready: Promise<void> | null = null;

export function ensureGhosttyInit(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}
