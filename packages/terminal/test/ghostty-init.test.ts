import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ghostty-init — ensureGhosttyInit', () => {
  // The `ready` promise is module-level state — reset modules between tests.
  let ensureGhosttyInit: () => Promise<void>;
  let initFromResponseFn: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    initFromResponseFn = vi.fn().mockResolvedValue(undefined);

    vi.doMock('ghostty-web', () => ({
      Terminal: vi.fn(),
      FitAddon: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
      initFromBytes: vi.fn().mockResolvedValue(undefined),
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
});
