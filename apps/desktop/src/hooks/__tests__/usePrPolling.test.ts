import { describe, it, expect } from 'vitest';

import { getPrInterval, prMapEqual } from '../usePrPolling';

import type { PrInfo } from '../../lib/github';

function makePr(
  branch: string,
  number: number,
  state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED',
): PrInfo {
  return { branch, number, state, url: `https://github.com/nept/superagent/pull/${number}` };
}

describe('getPrInterval', () => {
  it('returns 30s for 0 unchanged polls', () => {
    expect(getPrInterval(0)).toBe(30_000);
  });

  it('returns 30s for 4 unchanged polls', () => {
    expect(getPrInterval(4)).toBe(30_000);
  });

  it('returns 60s at 5 unchanged polls', () => {
    expect(getPrInterval(5)).toBe(60_000);
  });

  it('returns 60s at 9 unchanged polls', () => {
    expect(getPrInterval(9)).toBe(60_000);
  });

  it('returns 120s at 10 unchanged polls', () => {
    expect(getPrInterval(10)).toBe(120_000);
  });

  it('returns 120s at 20 unchanged polls', () => {
    expect(getPrInterval(20)).toBe(120_000);
  });
});

describe('prMapEqual', () => {
  it('returns true for identical maps', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(true);
  });

  it('returns true for both empty', () => {
    expect(prMapEqual({}, {})).toBe(true);
  });

  it('returns false when workspace count differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = {};
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when branch count differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'OPEN'), feat: makePr('feat', 2, 'DRAFT') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when PR number changes', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 2, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when PR state changes', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'MERGED') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when workspace key differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws2: { main: makePr('main', 1, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(false);
  });
});
