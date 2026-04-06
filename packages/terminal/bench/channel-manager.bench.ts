import { bench, describe } from 'vitest';

import { createChannelEntry } from '../src/channel-manager';

// Pre-build payloads once so allocation doesn't skew the benchmark.
const PAYLOAD_1B = Array.from({ length: 1 }, (_, i) => i & 0xff);
const PAYLOAD_1KB = Array.from({ length: 1024 }, (_, i) => i & 0xff);
const PAYLOAD_64KB = Array.from({ length: 64 * 1024 }, (_, i) => i & 0xff);
const PAYLOAD_1MB = Array.from({ length: 1024 * 1024 }, (_, i) => i & 0xff);

const NO_OP = () => {};

describe('channel-manager — onData throughput (setHandler path)', () => {
  // Entry created once; measures steady-state onData dispatch, not allocation.
  const entry = createChannelEntry();
  entry.setHandler(NO_OP);

  bench('1 B  payload', () => {
    entry.onData(PAYLOAD_1B);
  });

  bench('1 KB payload', () => {
    entry.onData(PAYLOAD_1KB);
  });

  bench('64 KB payload', () => {
    entry.onData(PAYLOAD_64KB);
  });

  bench('1 MB payload', () => {
    entry.onData(PAYLOAD_1MB);
  });
});

describe('channel-manager — scrollback flush latency (setHandler on pre-filled buffer)', () => {
  bench('flush 1 MB pre-handler buffer via setHandler', () => {
    const entry = createChannelEntry();
    for (let i = 0; i < 16; i++) {
      entry.onData(PAYLOAD_64KB);
    }
    entry.setHandler(NO_OP);
  });
});

describe('channel-manager — onData throughput (handler wired, live data)', () => {
  const liveEntry = createChannelEntry();
  liveEntry.setHandler(NO_OP);

  bench('1 KB live data', () => {
    liveEntry.onData(PAYLOAD_1KB);
  });

  bench('64 KB live data', () => {
    liveEntry.onData(PAYLOAD_64KB);
  });
});
