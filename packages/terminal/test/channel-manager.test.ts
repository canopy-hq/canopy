import { describe, it, expect } from 'vitest';

import { createChannelEntry } from '../src/channel-manager';

function bytes(...values: number[]): number[] {
  return values;
}

const sentinel: number[] = [];

// ---------------------------------------------------------------------------
// setHandler — reconnect / spawn path
// (Rust waited for sentinel, so buffer holds full scrollback when invoked)
// ---------------------------------------------------------------------------

describe('createChannelEntry — setHandler (flush path)', () => {
  it('buffers data before handler is set', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(1, 2, 3));
    entry.onData(bytes(4, 5, 6));
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    expect(received).toHaveLength(2);
    expect(Array.from(received[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(received[1]!)).toEqual([4, 5, 6]);
  });

  it('flushes buffer on setHandler, then forwards subsequent data directly', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(1));
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    expect(received).toHaveLength(1);
    entry.onData(bytes(2));
    expect(received).toHaveLength(2);
  });

  it('buffer is cleared after flush — re-wiring does not re-flush', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(10));
    const r1: Uint8Array[] = [];
    entry.setHandler((d) => r1.push(d));
    expect(r1).toHaveLength(1);

    const r2: Uint8Array[] = [];
    entry.setHandler((d) => r2.push(d));
    expect(r2).toHaveLength(0);
  });

  it('sentinel frame (empty rawData) is silently ignored', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    entry.onData(bytes(1));
    entry.onData(sentinel);
    entry.onData(bytes(2));
    expect(received).toHaveLength(2);
    expect(Array.from(received[0]!)).toEqual([1]);
    expect(Array.from(received[1]!)).toEqual([2]);
  });

  it('sentinel before handler: not buffered, not delivered', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(5));
    entry.onData(sentinel); // ignored
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([5]);
  });

  it('no handler set: data accumulates without error', () => {
    const entry = createChannelEntry();
    for (let i = 0; i < 100; i++) entry.onData(bytes(i));
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    expect(received).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// Large buffer — ensures no truncation
// ---------------------------------------------------------------------------

describe('createChannelEntry — large buffer', () => {
  it('flushes a 1 MB buffer completely via setHandler', () => {
    const CHUNK = 64 * 1024;
    const COUNT = 16;
    const entry = createChannelEntry();
    let expected = 0;
    for (let i = 0; i < COUNT; i++) {
      entry.onData(Array.from({ length: CHUNK }, (_, j) => (i * 7 + j) & 0xff));
      expected += CHUNK;
    }
    let received = 0;
    entry.setHandler((d) => {
      received += d.length;
    });
    expect(received).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Multi-byte sequences pass through unchanged
// ---------------------------------------------------------------------------

describe('createChannelEntry — encoding fidelity', () => {
  it('multi-byte UTF-8 sequences survive unchanged', () => {
    // 日本語 + 🚀
    const payload = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e, 0xf0, 0x9f, 0x9a, 0x80];
    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandler((d) => received.push(...Array.from(d)));
    entry.onData(payload);
    expect(received).toEqual(payload);
  });
});
