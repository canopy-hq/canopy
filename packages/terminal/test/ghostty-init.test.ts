import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ghostty-init — ensureGhosttyInit', () => {
  // The `ready` promise is module-level state — reset modules between tests.
  let ensureGhosttyInit: () => Promise<void>;
  let isGhosttyReady: () => boolean;
  let initFn: ReturnType<typeof vi.fn>;
  let initFromBytesFn: ReturnType<typeof vi.fn>;
  let initFromResponseFn: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    // Fresh IDB per test — prevents state leak between tests
    vi.stubGlobal('indexedDB', new IDBFactory());

    initFn = vi.fn().mockResolvedValue(undefined);
    initFromBytesFn = vi.fn().mockResolvedValue(undefined);
    initFromResponseFn = vi.fn().mockResolvedValue(undefined);

    vi.doMock('ghostty-web', () => ({
      Terminal: vi.fn(),
      FitAddon: vi.fn(),
      init: initFn,
      initFromBytes: initFromBytesFn,
      initFromResponse: initFromResponseFn,
    }));

    vi.doMock('ghostty-web/ghostty-vt.wasm?url', () => ({ default: '/ghostty-vt.wasm' }));

    fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(new ArrayBuffer(0), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../src/ghostty-init');
    ensureGhosttyInit = mod.ensureGhosttyInit;
    isGhosttyReady = mod.isGhosttyReady;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Deduplication ────────────────────────────────────────────────────────

  it('first call invokes initFromResponse() and returns a Promise', async () => {
    const result = ensureGhosttyInit();
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(initFromResponseFn).toHaveBeenCalledOnce();
  });

  it('two concurrent calls return the exact same Promise instance', async () => {
    const p1 = ensureGhosttyInit();
    const p2 = ensureGhosttyInit();
    expect(p1).toBe(p2);
    await p1;
    expect(initFromResponseFn).toHaveBeenCalledOnce();
  });

  it('10 concurrent calls still invoke initFromResponse() exactly once', async () => {
    const promises = Array.from({ length: 10 }, () => ensureGhosttyInit());
    // All promises are the same reference
    expect(new Set(promises).size).toBe(1);
    await promises[0];
    expect(initFromResponseFn).toHaveBeenCalledOnce();
  });

  it('after resolution, subsequent call returns the same resolved promise without re-invoking', async () => {
    const p1 = ensureGhosttyInit();
    await p1;
    const p2 = ensureGhosttyInit();
    expect(p2).toBe(p1);
    expect(initFromResponseFn).toHaveBeenCalledOnce();
  });

  // ─── isGhosttyReady ───────────────────────────────────────────────────────

  it('isGhosttyReady() is false before resolution and true after', async () => {
    expect(isGhosttyReady()).toBe(false);
    await ensureGhosttyInit();
    expect(isGhosttyReady()).toBe(true);
  });

  // ─── Cache hit path ───────────────────────────────────────────────────────

  it('uses initFromBytes when IDB has a cached entry', async () => {
    const bytes = new ArrayBuffer(16);

    // Pre-populate IDB with the expected cache key (ghostty-vt-test)
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('canopy-wasm-cache', 1);
      req.onupgradeneeded = (e) => {
        (e.target as IDBOpenDBRequest).result.createObjectStore('modules');
      };
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = db.transaction('modules', 'readwrite');
        tx.objectStore('modules').put(bytes, 'ghostty-vt-test');
        tx.oncomplete = () => resolve();
      };
      req.onerror = () => resolve();
    });

    // Make fetch never resolve so the cache always wins the race.
    // The AbortController in loadGhosttyModule will cancel it cleanly.
    fetchMock.mockImplementation(() => new Promise<never>(() => {}));

    await ensureGhosttyInit();
    expect(initFromBytesFn).toHaveBeenCalledWith(bytes);
    expect(initFromResponseFn).not.toHaveBeenCalled();
  });

  // ─── Fallback path ────────────────────────────────────────────────────────

  it('falls back to init() when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('network error'));
    await ensureGhosttyInit();
    expect(initFn).toHaveBeenCalledOnce();
    expect(initFromResponseFn).not.toHaveBeenCalled();
  });
});
