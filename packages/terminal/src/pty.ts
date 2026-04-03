import { invoke, Channel } from '@tauri-apps/api/core';
import { createChannelEntry, type ChannelEntry } from './channel-manager';

// Global registry: PTY output channels keyed by ptyId (child PID).
const outputRegistry = new Map<number, ChannelEntry>();

export async function spawnTerminal(paneId: string, cwd?: string, rows?: number, cols?: number): Promise<number> {
  const entry = createChannelEntry();

  const channel = new Channel<number[]>();
  channel.onmessage = (data: number[]) => {
    entry.onData(data);
  };

  const ptyId = await invoke<number>('spawn_terminal', { paneId, cwd, rows, cols, onOutput: channel });

  outputRegistry.set(ptyId, entry);
  return ptyId;
}

/** Wire (or re-wire) a PTY's output to a handler. Flushes buffered scrollback on first call (reconnect path). */
export function connectPtyOutput(ptyId: number, handler: (data: Uint8Array) => void): void {
  outputRegistry.get(ptyId)?.setHandler(handler);
}

/** Wire a PTY's output to a handler, discarding buffered scrollback and waiting for sentinel (spawn path). */
export function connectPtyOutputFresh(ptyId: number, handler: (data: Uint8Array) => void): void {
  outputRegistry.get(ptyId)?.setHandlerFresh(handler);
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
