import { invoke, Channel } from '@tauri-apps/api/core';

import { createChannelEntry, type ChannelEntry } from './channel-manager';

// Global registry: PTY output channels keyed by ptyId (child PID).
const outputRegistry = new Map<number, ChannelEntry>();
const encoder = new TextEncoder();

// Concurrent dedup: if two callers race before either invoke resolves,
// they share one promise → one Rust spawn_terminal call → one ChannelEntry.
const pendingSpawns = new Map<string, Promise<{ ptyId: number; isNew: boolean }>>();

function invokeWithChannel(
  command: string,
  paneId: string,
  cwd?: string,
  rows?: number,
  cols?: number,
): Promise<{ ptyId: number; isNew: boolean }> {
  const existing = pendingSpawns.get(paneId);
  if (existing) return existing;

  const promise = (async () => {
    const entry = createChannelEntry();
    const channel = new Channel<number[]>();
    channel.onmessage = (data: number[]) => entry.onData(data);

    const { pty_id, is_new } = await invoke<{ pty_id: number; is_new: boolean }>(command, {
      paneId,
      cwd,
      rows,
      cols,
      onOutput: channel,
    });

    outputRegistry.set(pty_id, entry);
    return { ptyId: pty_id, isNew: is_new };
  })().finally(() => pendingSpawns.delete(paneId));

  pendingSpawns.set(paneId, promise);
  return promise;
}

export function spawnTerminal(
  paneId: string,
  cwd?: string,
  rows?: number,
  cols?: number,
): Promise<{ ptyId: number; isNew: boolean }> {
  return invokeWithChannel('spawn_terminal', paneId, cwd, rows, cols);
}

export function claimWarmTerminal(
  paneId: string,
  cwd?: string,
  rows?: number,
  cols?: number,
): Promise<{ ptyId: number; isNew: boolean }> {
  return invokeWithChannel('claim_warm_terminal', paneId, cwd, rows, cols);
}

/** Debug only — not used in hot path. */
export async function getPoolStatus(): Promise<{ ready: number; warming: number }> {
  return invoke<{ ready: number; warming: number }>('pool_status');
}

/** Wire (or re-wire) a PTY's output to a handler. Flushes buffered scrollback on first call (reconnect path). */
export function connectPtyOutput(ptyId: number, handler: (data: Uint8Array) => void): void {
  outputRegistry.get(ptyId)?.setHandler(handler);
}

/** Discard buffered scrollback and wire handler for live data only (pool claim path). */
export function connectPtyOutputFresh(ptyId: number, handler: (data: Uint8Array) => void): void {
  outputRegistry.get(ptyId)?.setHandlerFresh(handler);
}

export async function writeToPty(ptyId: number, data: string): Promise<void> {
  const bytes = Array.from(encoder.encode(data));
  return invoke('write_to_pty', { ptyId, data: bytes });
}

export async function resizePty(ptyId: number, rows: number, cols: number): Promise<void> {
  return invoke('resize_pty', { ptyId, rows, cols });
}

export async function closePty(ptyId: number): Promise<void> {
  outputRegistry.delete(ptyId);
  return invoke('close_pty', { ptyId });
}

/**
 * Close all PTY sessions matching the given pane IDs (catch-all cleanup).
 * Does NOT touch outputRegistry — callers must first call closePty() for
 * known ptyIds (which cleans the registry). This function only targets
 * daemon-side orphans that were never spawned in this frontend session.
 */
export async function closePtysForPanes(paneIds: string[]): Promise<void> {
  if (paneIds.length === 0) return;
  return invoke('close_ptys_for_panes', { paneIds });
}

export async function getPtyCwd(ptyId: number): Promise<string> {
  return invoke<string>('get_pty_cwd', { ptyId });
}

export interface PtySessionInfo {
  ptyId: number;
  paneId: string;
  cpuPercent: number;
  memoryMb: number;
}

export async function listPtySessions(): Promise<PtySessionInfo[]> {
  const raw =
    await invoke<{ pty_id: number; pane_id: string; cpu_percent: number; memory_mb: number }[]>(
      'list_pty_sessions',
    );
  return raw.map((s) => ({
    ptyId: s.pty_id,
    paneId: s.pane_id,
    cpuPercent: s.cpu_percent,
    memoryMb: s.memory_mb,
  }));
}
