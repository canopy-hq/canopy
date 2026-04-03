import { bench, describe } from 'vitest';

import { disposeCached, getCached, setCached } from '../src/terminal-cache';

// Stub term/fitAddon — only need objects with a dispose method.
const stubTerm = { dispose: () => {} } as any;
const stubFitAddon = {} as any;

// Use a global counter for unique ptyIds so entries from previous bench
// iterations don't accumulate and skew the "get" benchmarks.
let counter = 1_000_000;

describe('terminal-cache — setCached throughput', () => {
  bench('setCached (new entry each iteration)', () => {
    setCached(counter++, stubTerm, stubFitAddon);
  });
});

describe('terminal-cache — getCached throughput', () => {
  // Pre-populate once outside the bench loop.
  const SIZES = [1, 10, 100] as const;

  for (const n of SIZES) {
    // Stable base ptyId range for each size tier.
    const base = n * 10_000;
    for (let i = 0; i < n; i++) {
      setCached(base + i, stubTerm, stubFitAddon);
    }

    bench(`getCached — ${n} entries, lookup existing`, () => {
      // Look up the last entry in the set (exercises the map).
      getCached(base + (n - 1));
    });

    bench(`getCached — ${n} entries, lookup missing`, () => {
      getCached(base + n + 1); // always absent
    });
  }
});

describe('terminal-cache — disposeCached throughput', () => {
  bench('disposeCached (insert then remove)', () => {
    const id = counter++;
    setCached(id, stubTerm, stubFitAddon);
    disposeCached(id);
  });
});
