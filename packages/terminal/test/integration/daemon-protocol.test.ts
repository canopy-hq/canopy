/**
 * Cross-layer integration tests: packages/pty-daemon ↔ packages/terminal
 *
 * These tests start the real `superagent-pty-daemon` binary, connect to it via
 * a Unix socket, and feed the raw binary frames into the TypeScript channel-manager
 * — exactly the path that Tauri IPC takes in production (minus Tauri itself).
 *
 * Prerequisites: build the daemon binary first.
 *   cargo build --bin superagent-pty-daemon
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createChannelEntry } from '../../src/channel-manager';

// ─── Daemon binary path ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/terminal/test/integration/ → 4 levels up = repo root
const DAEMON_BIN = path.resolve(__dirname, '../../../../target/debug/superagent-pty-daemon');

// ─── Buffered socket reader ───────────────────────────────────────────────────

/**
 * Accumulates incoming data and allows reading exact byte counts
 * without the "excess data" problem of raw event listeners.
 */
class DataBuffer {
  private buf = Buffer.alloc(0);
  private waiters: Array<{ needed: number; resolve: (b: Buffer) => void }> = [];
  private closed = false;
  private closeWaiters: Array<() => void> = [];

  push(data: Buffer) {
    this.buf = Buffer.concat([this.buf, data]);
    while (this.waiters.length > 0 && this.buf.length >= this.waiters[0]!.needed) {
      const { needed, resolve } = this.waiters.shift()!;
      resolve(Buffer.from(this.buf.subarray(0, needed)));
      this.buf = this.buf.subarray(needed);
    }
  }

  close() {
    this.closed = true;
    for (const cb of this.closeWaiters) cb();
  }

  read(n: number): Promise<Buffer> {
    if (this.buf.length >= n) {
      const result = Buffer.from(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
      return Promise.resolve(result);
    }
    return new Promise((resolve) => {
      this.waiters.push({ needed: n, resolve });
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function socketPath() {
  return `/tmp/test-daemon-ts-${process.hrtime.bigint()}.sock`;
}

async function startDaemon(sockPath: string): Promise<ChildProcess> {
  if (!fs.existsSync(DAEMON_BIN)) {
    throw new Error(
      `Daemon binary not found at ${DAEMON_BIN}.\nRun: cargo build --bin superagent-pty-daemon`,
    );
  }
  const proc = spawn(DAEMON_BIN, [sockPath], { stdio: 'ignore' });
  // Retry until socket appears (up to 1s)
  for (let i = 0; i < 40; i++) {
    await sleep(25);
    try {
      await connectSocket(sockPath);
      return proc;
    } catch {
      // not ready yet
    }
  }
  throw new Error('Daemon did not start within 1s');
}

function connectSocket(sockPath: string): Promise<{ socket: net.Socket; buf: DataBuffer }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: sockPath });
    const buf = new DataBuffer();
    socket.on('data', (chunk: Buffer) => buf.push(chunk));
    socket.on('close', () => buf.close());
    socket.once('connect', () => resolve({ socket, buf }));
    socket.once('error', reject);
  });
}

function sendLine(socket: net.Socket, json: object) {
  socket.write(JSON.stringify(json) + '\n');
}

async function readJsonLine(buf: DataBuffer): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  while (true) {
    const byte = await buf.read(1);
    if (byte[0] === 0x0a /* \n */) break;
    chunks.push(byte);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/** Read one binary frame: [u32 BE len][bytes]. Returns empty Buffer for sentinel. */
async function readFrame(buf: DataBuffer): Promise<Buffer> {
  const lenBuf = await buf.read(4);
  const len = lenBuf.readUInt32BE(0);
  if (len === 0) return Buffer.alloc(0);
  return buf.read(len);
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let daemonProc: ChildProcess;
let sockPath: string;

beforeEach(async () => {
  sockPath = socketPath();
  daemonProc = await startDaemon(sockPath);
});

afterEach(() => {
  daemonProc.kill();
  try {
    fs.unlinkSync(sockPath);
  } catch {
    /* already gone */
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('daemon → channel-manager protocol', () => {
  it('scrollback → sentinel → channel-manager receives bytes intact', async () => {
    // Spawn a shell that produces known output
    const { socket: s1, buf: b1 } = await connectSocket(sockPath);
    sendLine(s1, {
      op: 'spawn',
      paneId: 'p1',
      rows: 24,
      cols: 80,
      command: 'sh',
      args: ['-c', "printf 'DAEMON_OUTPUT_12345'"],
    });
    const resp = await readJsonLine(b1);
    expect(resp['ok']).toBe(true);
    s1.destroy();

    // Wait for printf to complete
    await sleep(200);

    // Attach and collect frames
    const { socket: s2, buf: b2 } = await connectSocket(sockPath);
    sendLine(s2, { op: 'attach', paneId: 'p1' });

    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandler((d) => received.push(...Array.from(d)));

    // Read frames until sentinel, feeding each into the channel-manager
    let sentinelReceived = false;
    for (let i = 0; i < 50; i++) {
      const frame = await readFrame(b2);
      if (frame.length === 0) {
        entry.onData([]); // sentinel
        sentinelReceived = true;
        break;
      }
      entry.onData(Array.from(frame));
    }

    s2.destroy();

    expect(sentinelReceived).toBe(true);
    const text = Buffer.from(received).toString('utf8');
    expect(text).toContain('DAEMON_OUTPUT_12345');
  });

  it('setHandlerFresh discards pre-sentinel frames, delivers only live bytes', async () => {
    const { socket: s1, buf: b1 } = await connectSocket(sockPath);
    sendLine(s1, {
      op: 'spawn',
      paneId: 'p2',
      rows: 24,
      cols: 80,
      command: 'sh',
      args: ['-c', "printf 'SCROLLBACK_DATA'"],
    });
    await readJsonLine(b1);
    s1.destroy();

    await sleep(200);

    // Read all frames from the daemon
    const { socket: s2, buf: b2 } = await connectSocket(sockPath);
    sendLine(s2, { op: 'attach', paneId: 'p2' });

    const allFrames: Buffer[] = [];
    for (let i = 0; i < 50; i++) {
      const frame = await readFrame(b2);
      allFrames.push(frame);
      if (frame.length === 0) break; // sentinel reached
    }
    s2.destroy();

    // Feed all frames into the channel-manager using the fresh (spawn) path
    const entry = createChannelEntry();
    const freshReceived: number[] = [];
    entry.setHandlerFresh((d) => freshReceived.push(...Array.from(d)));

    for (const frame of allFrames) {
      entry.onData(Array.from(frame));
    }

    // Fresh handler must NOT have received scrollback (pre-sentinel frames)
    // It will receive nothing here since we have no live frames beyond sentinel
    // — the key assertion is that the scrollback did NOT reach the handler
    expect(freshReceived).toHaveLength(0);
  });

  it('ANSI + Unicode + emoji bytes survive the full round-trip', async () => {
    const knownPayload = '\x1b[1;32m日本語\x1b[0m 🚀';
    const knownBytes = Array.from(Buffer.from(knownPayload, 'utf8'));

    const { socket: s1, buf: b1 } = await connectSocket(sockPath);
    sendLine(s1, {
      op: 'spawn',
      paneId: 'p3',
      rows: 24,
      cols: 80,
      command: 'sh',
      args: ['-c', `printf '${knownPayload}'`],
    });
    await readJsonLine(b1);
    s1.destroy();

    await sleep(200);

    const { socket: s2, buf: b2 } = await connectSocket(sockPath);
    sendLine(s2, { op: 'attach', paneId: 'p3' });

    const entry = createChannelEntry();
    const received: number[] = [];
    entry.setHandler((d) => received.push(...Array.from(d)));

    for (let i = 0; i < 50; i++) {
      const frame = await readFrame(b2);
      if (frame.length === 0) {
        entry.onData([]);
        break;
      }
      entry.onData(Array.from(frame));
    }
    s2.destroy();

    // The known bytes must appear somewhere in the received stream
    const text = Buffer.from(received).toString('utf8');
    expect(text).toContain('日本語');
    expect(text).toContain('🚀');
    // Verify individual UTF-8 byte sequences are intact
    const receivedBuf = Buffer.from(received);
    const knownBuf = Buffer.from(knownBytes);
    const idx = receivedBuf.indexOf(knownBuf);
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});
