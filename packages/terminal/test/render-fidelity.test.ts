/**
 * Render fidelity tests
 *
 * Part 1 — Channel pipeline fidelity (no mocks, pure logic)
 *   Verifies the channel-manager is a byte-transparent conduit: every byte
 *   sent in — including complex ANSI sequences, box-drawing chars, CJK, and
 *   emoji — exits unchanged regardless of chunk boundaries or protocol phase.
 *
 * Part 2 — Terminal instance identity on remount (mocked hooks)
 *   Verifies that the cached remount path reuses the exact same Terminal
 *   object: no reset, no re-write, no dispose, reconnect path only.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Part 1 mocks (none needed — channel-manager is pure logic) ──────────────
// ─── Part 2 mocks ────────────────────────────────────────────────────────────

vi.mock('ghostty-web', async () => {
  const { createGhosttyWebMock } = await import('./__mocks__/ghostty-web');
  return createGhosttyWebMock();
});

vi.mock('@superagent/db', async () => {
  const { createDbMock } = await import('./__mocks__/superagent-db');
  return createDbMock();
});

vi.mock('../src/ghostty-init', () => ({
  ensureGhosttyInit: vi.fn().mockResolvedValue(undefined),
  isGhosttyReady: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/pty', () => ({
  spawnTerminal: vi.fn().mockResolvedValue(42),
  connectPtyOutput: vi.fn(),
  connectPtyOutputFresh: vi.fn(),
  writeToPty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getPtyCwd: vi.fn().mockResolvedValue('/home/user'),
}));

vi.mock('../src/terminal-cache', () => ({
  getCached: vi.fn(() => undefined),
  setCached: vi.fn(),
  disposeCached: vi.fn(),
  getAllCached: vi.fn(() => new Map()),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Terminal, FitAddon } from 'ghostty-web';

import { createChannelEntry } from '../src/channel-manager';
import { connectPtyOutput, connectPtyOutputFresh } from '../src/pty';
import { getCached, setCached } from '../src/terminal-cache';
import { useTerminal } from '../src/useTerminal';

// ─── ASCII art payload ────────────────────────────────────────────────────────

/**
 * A realistic terminal payload mixing:
 * - ANSI SGR codes (colors, bold, reset)
 * - Box-drawing characters (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼)
 * - CJK characters (日本語)
 * - Emoji (🚀 ✅ ❌)
 * - Cursor positioning sequences
 */
const ASCII_ART_STRING = [
  '\x1b[2J\x1b[H', // clear screen, home cursor
  '\x1b[1;32m┌───────────────────┐\x1b[0m\r\n',
  '\x1b[1;32m│\x1b[0m \x1b[38;5;196mSUPERAGENT\x1b[0m \x1b[38;5;214mv1.0.0\x1b[0m \x1b[1;32m│\x1b[0m\r\n',
  '\x1b[1;32m│\x1b[0m \x1b[1;34m日本語\x1b[0m          \x1b[1;32m│\x1b[0m\r\n',
  '\x1b[1;32m├───────────────────┤\x1b[0m\r\n',
  '\x1b[1;32m│\x1b[0m 🚀 \x1b[1;33mReady\x1b[0m          \x1b[1;32m│\x1b[0m\r\n',
  '\x1b[1;32m│\x1b[0m ✅ \x1b[32mConnected\x1b[0m       \x1b[1;32m│\x1b[0m\r\n',
  '\x1b[1;32m│\x1b[0m ❌ \x1b[31mError: none\x1b[0m    \x1b[1;32m│\x1b[0m\r\n',
  '\x1b[1;32m└───────────────────┘\x1b[0m\r\n',
  '\x1b[?25h', // show cursor
].join('');

const encoder = new TextEncoder();
const ASCII_ART_BYTES = Array.from(encoder.encode(ASCII_ART_STRING));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { flushPromises, makeContainer } from './helpers';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCached).mockReturnValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── Part 1: Channel pipeline fidelity ───────────────────────────────────────

describe('channel pipeline — ASCII art payload fidelity', () => {
  it('full payload as single chunk — byte-for-byte identical output (setHandler)', () => {
    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandler((d) => received.push(...Array.from(d)));
    entry.onData(ASCII_ART_BYTES);
    expect(received).toEqual(ASCII_ART_BYTES);
  });

  it('payload split into 17 unequal chunks — concatenated output is byte-identical (setHandler)', () => {
    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandler((d) => received.push(...Array.from(d)));

    // Split at prime-ish offsets to cut mid-escape-sequence
    const total = ASCII_ART_BYTES.length;
    const splits = [7, 13, 5, 31, 17, 2, 43, 11, 19, 3, 29, 37, 23, 41, 7, 11, 0];
    let offset = 0;
    for (const size of splits) {
      const chunkSize = Math.min(size === 0 ? total - offset : size, total - offset);
      if (chunkSize <= 0) break;
      entry.onData(ASCII_ART_BYTES.slice(offset, offset + chunkSize));
      offset += chunkSize;
    }
    // Send any remainder as one final chunk
    if (offset < total) {
      entry.onData(ASCII_ART_BYTES.slice(offset));
    }

    expect(received).toEqual(ASCII_ART_BYTES);
  });

  it('setHandlerFresh path — only post-sentinel bytes reach handler, byte-identical', () => {
    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandlerFresh((d) => received.push(...Array.from(d)));

    // Scrollback (should be discarded)
    entry.onData(ASCII_ART_BYTES);
    // Sentinel
    entry.onData([]);
    // Live data (should arrive intact)
    entry.onData(ASCII_ART_BYTES);

    expect(received).toEqual(ASCII_ART_BYTES);
  });

  it('100× repeated payload — no truncation, total byte count exact', () => {
    const REPEAT = 100;
    const entry = createChannelEntry();
    let totalReceived = 0;
    entry.setHandler((d) => {
      totalReceived += d.length;
    });

    for (let i = 0; i < REPEAT; i++) {
      entry.onData(ASCII_ART_BYTES);
    }

    expect(totalReceived).toBe(ASCII_ART_BYTES.length * REPEAT);
  });
});

// ─── Part 2: Terminal instance identity on remount ────────────────────────────

describe('terminal remount identity — render state 100% preserved', () => {
  function makeCachedTerminal() {
    const term = new (vi.mocked(Terminal) as any)() as any;
    const fitAddon = new (vi.mocked(FitAddon) as any)() as any;
    const el = document.createElement('div');
    document.body.appendChild(el);
    term.element = el;
    // Reset all mock tracking after construction
    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term, fitAddon });
    return { term, fitAddon, el };
  }

  it('same Terminal instance — strict object identity', async () => {
    const { term } = makeCachedTerminal();
    const container = makeContainer();
    const { result, unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    expect(result.current.current).toBe(term);
    unmount();
  });

  it('same DOM node — same element reference, not a clone', async () => {
    const { term, el } = makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    expect(container.firstChild).toBe(el);
    // Explicitly verify term.element identity
    expect(container.firstChild).toBe(term.element);
    unmount();
  });

  it('term.reset() is NOT called — buffer is fully preserved', async () => {
    const { term } = makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    expect(term.reset).not.toHaveBeenCalled();
    unmount();
  });

  it('term.write() is NOT called — no content replay through the channel', async () => {
    const { term } = makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    expect(term.write).not.toHaveBeenCalled();
    unmount();
  });

  it('term.dispose() is NOT called on unmount — cache keeps the instance alive', async () => {
    const { term } = makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);
    unmount();

    expect(term.dispose).not.toHaveBeenCalled();
  });

  it('connectPtyOutput used (not fresh) — overlay never shown, scrollback preserved', async () => {
    makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(7, expect.any(Function));
    expect(connectPtyOutputFresh).not.toHaveBeenCalled();
    unmount();
  });

  it('no new Terminal() constructed — getCached() is the only source', async () => {
    makeCachedTerminal();
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );

    await act(flushPromises);

    // Terminal constructor should have been called 0 times since makeCachedTerminal
    // pre-cleared all mocks after construction.
    expect(vi.mocked(Terminal)).not.toHaveBeenCalled();
    // setCached should NOT have been called (no new entry)
    expect(setCached).not.toHaveBeenCalled();
    unmount();
  });
});
