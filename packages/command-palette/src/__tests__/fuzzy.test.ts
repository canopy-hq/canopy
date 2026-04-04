import { describe, it, expect } from 'vitest';

import { fuzzyScore, fuzzyFilter } from '../fuzzy';

import type { CommandItem } from '../types';

function item(id: string, label: string, keywords?: string[]): CommandItem {
  return { id, label, category: 'action', keywords, action: () => {} };
}

describe('fuzzyScore', () => {
  it('returns 200 for exact match', () => {
    expect(fuzzyScore('hello', 'hello')).toBe(200);
  });

  it('returns 150 for prefix match', () => {
    expect(fuzzyScore('hel', 'hello')).toBe(150);
  });

  it('returns 100 for substring match', () => {
    expect(fuzzyScore('llo', 'hello')).toBe(100);
  });

  it('returns -1 when not all query chars found', () => {
    expect(fuzzyScore('xyz', 'hello')).toBe(-1);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('HEL', 'hello')).toBe(150);
  });

  it('returns 1 for empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(1);
  });
});

describe('fuzzyFilter', () => {
  it('returns all items for empty query', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta')];
    expect(fuzzyFilter('', items)).toEqual(items);
  });

  it('filters out non-matching items', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta')];
    const result = fuzzyFilter('alp', items);
    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('matches on keywords when label does not match', () => {
    const items = [item('a', 'Open Settings', ['preferences', 'config'])];
    expect(fuzzyFilter('pref', items).map((i) => i.id)).toEqual(['a']);
  });

  it('sorts better matches first', () => {
    const items = [item('a', 'toggle sidebar'), item('b', 'sidebar')];
    const result = fuzzyFilter('sidebar', items);
    // exact match "sidebar" should score higher than "toggle sidebar"
    expect(result[0]?.id).toBe('b');
  });
});
