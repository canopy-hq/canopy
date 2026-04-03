import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('terminal-cache', () => {
  // Each test gets a fresh module instance (the cache Map is module-level state).
  let getCached: (id: number) => { term: any; fitAddon: any } | undefined;
  let setCached: (id: number, term: any, fitAddon: any) => void;
  let disposeCached: (id: number) => void;
  let getAllCached: () => Map<number, { term: any; fitAddon: any }>;

  beforeEach(async () => {
    vi.resetModules();
    // ghostty-web is imported for types only; mock to avoid WASM resolution errors.
    vi.doMock('ghostty-web', () => ({
      Terminal: vi.fn(),
      FitAddon: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
    }));
    const mod = await import('../src/terminal-cache');
    getCached = mod.getCached;
    setCached = mod.setCached;
    disposeCached = mod.disposeCached;
    getAllCached = mod.getAllCached;
  });

  it('getCached returns undefined for an unknown ptyId', () => {
    expect(getCached(999)).toBeUndefined();
  });

  it('setCached stores and getCached retrieves the entry', () => {
    const term = { dispose: vi.fn() };
    const fitAddon = {};
    setCached(1, term, fitAddon);
    const entry = getCached(1);
    expect(entry).toBeDefined();
    expect(entry!.term).toBe(term);
    expect(entry!.fitAddon).toBe(fitAddon);
  });

  it('setCached overwrites an existing entry for the same ptyId', () => {
    const termA = { dispose: vi.fn() };
    const termB = { dispose: vi.fn() };
    const fitAddon = {};
    setCached(2, termA, fitAddon);
    setCached(2, termB, fitAddon);
    expect(getCached(2)!.term).toBe(termB);
  });

  it('disposeCached calls term.dispose() and removes the entry', () => {
    const term = { dispose: vi.fn() };
    setCached(3, term, {});
    disposeCached(3);
    expect(term.dispose).toHaveBeenCalledOnce();
    expect(getCached(3)).toBeUndefined();
  });

  it('disposeCached on an unknown ptyId is a no-op', () => {
    // Should not throw
    expect(() => disposeCached(404)).not.toThrow();
  });

  it('getAllCached returns the live Map reference (not a snapshot)', () => {
    // NOTE: current implementation returns the internal Map directly.
    // Callers should treat the result as read-only; mutations will affect the cache.
    const map = getAllCached();
    expect(map).toBeInstanceOf(Map);
    const term = { dispose: vi.fn() };
    setCached(5, term, {});
    // Because it's a live reference, the map reflects the new entry immediately.
    expect(map.has(5)).toBe(true);
  });

  it('re-caching a ptyId after dispose works cleanly', () => {
    const termA = { dispose: vi.fn() };
    const termB = { dispose: vi.fn() };
    setCached(6, termA, {});
    disposeCached(6);
    expect(getCached(6)).toBeUndefined();
    setCached(6, termB, {});
    expect(getCached(6)!.term).toBe(termB);
  });
});
