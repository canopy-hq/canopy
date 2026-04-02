import { invoke, Channel } from '@tauri-apps/api/core';

// Global registry: PTY output channels keyed by ptyId (child PID).
// Allows useTerminal to wire the ghostty-web terminal to the daemon output stream.
const outputRegistry = new Map<number, {
  setHandler: (h: (data: Uint8Array) => void) => void;
}>();

export async function spawnTerminal(paneId: string, cwd?: string): Promise<number> {
  const buffer: Uint8Array[] = [];
  let handler: ((data: Uint8Array) => void) | null = null;

  const channel = new Channel<number[]>();
  channel.onmessage = (data: number[]) => {
    const bytes = new Uint8Array(data);
    if (handler) {
      handler(bytes);
    } else {
      buffer.push(bytes);
    }
  };

  const ptyId = await invoke<number>('spawn_terminal', { paneId, cwd, onOutput: channel });

  outputRegistry.set(ptyId, {
    setHandler: (h) => {
      handler = h;
      for (const b of buffer) h(b);
      buffer.length = 0;
    },
  });

  return ptyId;
}

/** Wire (or re-wire) a PTY's output to a handler. Flushes buffered data on first call. */
export function connectPtyOutput(ptyId: number, handler: (data: Uint8Array) => void): void {
  const entry = outputRegistry.get(ptyId);
  if (entry) entry.setHandler(handler);
}

export async function writeToPty(ptyId: number, data: string): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(data));
  return invoke('write_to_pty', { ptyId, data: bytes });
}

export async function resizePty(ptyId: number, rows: number, cols: number): Promise<void> {
  return invoke('resize_pty', { ptyId, rows, cols });
}

export async function closePty(ptyId: number): Promise<void> {
  outputRegistry.delete(ptyId);
  return invoke('close_pty', { ptyId });
}

export async function getPtyCwd(ptyId: number): Promise<string> {
  return invoke<string>('get_pty_cwd', { ptyId });
}
