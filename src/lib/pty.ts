import { invoke, Channel } from '@tauri-apps/api/core';

export async function spawnTerminal(
  onOutput: (data: Uint8Array) => void,
): Promise<number> {
  const channel = new Channel<number[]>();
  channel.onmessage = (data: number[]) => {
    onOutput(new Uint8Array(data));
  };
  return invoke<number>('spawn_terminal', { onOutput: channel });
}

export async function writeToPty(ptyId: number, data: string): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(data));
  return invoke('write_to_pty', { ptyId, data: bytes });
}

export async function resizePty(ptyId: number, rows: number, cols: number): Promise<void> {
  return invoke('resize_pty', { ptyId, rows, cols });
}
