import { describe, it, expect, vi } from 'vitest';
import { createChannelEntry } from '../src/channel-manager';

function bytes(...values: number[]): number[] {
  return values;
}

const sentinel: number[] = [];

describe('createChannelEntry — setHandler (reconnect path)', () => {
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

  it('forwards subsequent data directly to handler', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    entry.onData(bytes(7, 8, 9));
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([7, 8, 9]);
  });

  it('sentinel is a no-op — does not stop data forwarding', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    entry.onData(bytes(1));
    entry.onData(sentinel); // sentinel
    entry.onData(bytes(2));
    expect(received).toHaveLength(2);
    expect(Array.from(received[0]!)).toEqual([1]);
    expect(Array.from(received[1]!)).toEqual([2]);
  });

  it('pre-handler buffer is cleared after flush', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(1));
    const r1: Uint8Array[] = [];
    entry.setHandler((d) => r1.push(d));
    // Re-wiring should NOT re-flush old data
    const r2: Uint8Array[] = [];
    entry.setHandler((d) => r2.push(d));
    expect(r2).toHaveLength(0);
  });
});

describe('createChannelEntry — setHandlerFresh (spawn path)', () => {
  it('discards pre-handler buffer when setHandlerFresh is called', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(1, 2, 3)); // scrollback
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    expect(received).toHaveLength(0);
  });

  it('buffers data arriving between setHandlerFresh and sentinel', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    entry.onData(bytes(10, 20)); // post-handler scrollback
    entry.onData(bytes(30, 40)); // post-handler scrollback
    expect(received).toHaveLength(0);
  });

  it('discards the post-handler buffer when sentinel arrives', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    entry.onData(bytes(10));
    entry.onData(bytes(20));
    entry.onData(sentinel); // sentinel — discard buffered scrollback
    expect(received).toHaveLength(0);
  });

  it('forwards data arriving after sentinel to handler', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    entry.onData(bytes(10)); // scrollback (buffered)
    entry.onData(sentinel);  // sentinel (discards buffer)
    entry.onData(bytes(42)); // live data
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([42]);
  });

  it('multiple live data chunks after sentinel all reach handler', () => {
    const entry = createChannelEntry();
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    entry.onData(sentinel);
    entry.onData(bytes(1));
    entry.onData(bytes(2));
    entry.onData(bytes(3));
    expect(received).toHaveLength(3);
  });

  it('when sentinel arrived before setHandlerFresh: forwards data immediately', () => {
    const entry = createChannelEntry();
    // Sentinel arrives before handler is wired (scrollback already done)
    entry.onData(bytes(1)); // pre-handler scrollback
    entry.onData(sentinel);
    entry.onData(bytes(2)); // live data, arrives before handler
    const received: Uint8Array[] = [];
    // setHandlerFresh is called after sentinel — should NOT buffer post-sentinel data
    entry.setHandlerFresh((d) => received.push(d));
    // Pre-handler buffer is discarded (scrollback + live that arrived before handler)
    expect(received).toHaveLength(0);
    // Subsequent data flows immediately (sentinel already received)
    entry.onData(bytes(99));
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([99]);
  });
});

describe('createChannelEntry — full StrictMode sequence', () => {
  it('scrollback → sentinel → live: only live data reaches handler (fresh mode)', () => {
    const entry = createChannelEntry();
    // Phase 1: scrollback chunks arrive before handler is wired
    entry.onData(bytes(0x1b, 0x5b)); // escape sequence (scrollback)
    entry.onData(bytes(0x41, 0x42)); // more scrollback
    // handler wired (StrictMode second mount .then() fires)
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    // Phase 2: more scrollback arrives after handler (streaming replay)
    entry.onData(bytes(0xc3, 0xa9)); // still scrollback, post-handler
    // Phase 3: sentinel
    entry.onData(sentinel);
    // Phase 4: live data (shell prompt)
    entry.onData(bytes(0x24, 0x20)); // "$ "
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([0x24, 0x20]);
  });

  it('scrollback → sentinel → live: all data reaches handler (normal mode)', () => {
    const entry = createChannelEntry();
    entry.onData(bytes(0x41)); // scrollback
    entry.onData(bytes(0x42)); // scrollback
    const received: Uint8Array[] = [];
    entry.setHandler((d) => received.push(d));
    // Scrollback flushed immediately
    expect(received).toHaveLength(2);
    // Sentinel is a no-op
    entry.onData(sentinel);
    // Live data forwarded
    entry.onData(bytes(0x43));
    expect(received).toHaveLength(3);
  });

  it('empty scrollback + sentinel + live: only live data in fresh mode', () => {
    const entry = createChannelEntry();
    // No scrollback before handler
    const received: Uint8Array[] = [];
    entry.setHandlerFresh((d) => received.push(d));
    // Sentinel arrives immediately (session had no history)
    entry.onData(sentinel);
    // Live
    entry.onData(bytes(0x7e));
    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([0x7e]);
  });
});

describe('createChannelEntry — overlay scenario', () => {
  it('overlay is removed only on first live byte, never on scrollback', () => {
    const entry = createChannelEntry();
    let overlayRemoved = false;
    const written: number[][] = [];

    entry.setHandlerFresh((data) => {
      if (!overlayRemoved) {
        overlayRemoved = true;
      }
      written.push(Array.from(data));
    });

    // Scrollback bytes — must NOT reach handler
    entry.onData(bytes(0x01, 0x02, 0x03));
    expect(overlayRemoved).toBe(false);

    // Sentinel
    entry.onData(sentinel);
    expect(overlayRemoved).toBe(false);

    // First live byte — overlay removed here
    entry.onData(bytes(0x24));
    expect(overlayRemoved).toBe(true);
    expect(written).toEqual([[0x24]]);
  });

  it('overlay is NOT affected by an observer using setHandler', () => {
    const entry = createChannelEntry();
    let overlayRemoved = false;
    entry.setHandler((data) => {
      if (!overlayRemoved) overlayRemoved = true;
      void data;
    });
    entry.onData(bytes(1, 2, 3));
    // In reconnect mode the first byte removes the overlay (correct behavior)
    expect(overlayRemoved).toBe(true);
  });
});
