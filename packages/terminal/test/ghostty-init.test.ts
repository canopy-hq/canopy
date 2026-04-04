import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ghostty-init — ensureGhosttyInit', () => {
  // The `ready` promise is module-level state — reset modules between tests.
  let ensureGhosttyInit: () => Promise<void>;
  let initFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    initFn = vi.fn().mockResolvedValue(undefined);
    vi.doMock('ghostty-web', () => ({ Terminal: vi.fn(), FitAddon: vi.fn(), init: initFn }));
    const mod = await import('../src/ghostty-init');
    ensureGhosttyInit = mod.ensureGhosttyInit;
  });

  it('first call invokes init() and returns a Promise', () => {
    const result = ensureGhosttyInit();
    expect(initFn).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(Promise);
  });

  it('two concurrent calls return the exact same Promise instance', () => {
    const p1 = ensureGhosttyInit();
    const p2 = ensureGhosttyInit();
    expect(p1).toBe(p2);
    expect(initFn).toHaveBeenCalledOnce();
  });

  it('10 concurrent calls still invoke init() exactly once', () => {
    const promises = Array.from({ length: 10 }, () => ensureGhosttyInit());
    expect(initFn).toHaveBeenCalledOnce();
    // All promises are the same reference
    expect(new Set(promises).size).toBe(1);
  });

  it('after resolution, subsequent call returns the same resolved promise without re-invoking init()', async () => {
    const p1 = ensureGhosttyInit();
    await p1;
    const p2 = ensureGhosttyInit();
    expect(p2).toBe(p1);
    expect(initFn).toHaveBeenCalledOnce();
  });
});
