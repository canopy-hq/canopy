import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('terminal-font-size', () => {
  let applyFontSizeToAll: (size: number) => void;
  let setCached: (id: number, term: any, fitAddon: any) => void;
  let invokeFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    invokeFn = vi.fn().mockResolvedValue(undefined);
    vi.doMock('ghostty-web', () => ({ Terminal: vi.fn(), FitAddon: vi.fn() }));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeFn }));
    vi.doMock('../src/channel-manager', () => ({ getOrCreateChannel: vi.fn() }));

    const cache = await import('../src/terminal-cache');
    setCached = cache.setCached;

    const mod = await import('../src/terminal-font-size');
    applyFontSizeToAll = mod.applyFontSizeToAll;
  });

  it('sets fontSize on all cached terminals and refits', () => {
    const term1 = { options: { fontSize: 14 }, rows: 24, cols: 80 };
    const fit1 = { fit: vi.fn() };
    const term2 = { options: { fontSize: 14 }, rows: 30, cols: 120 };
    const fit2 = { fit: vi.fn() };

    setCached(1, term1 as any, fit1 as any);
    setCached(2, term2 as any, fit2 as any);

    applyFontSizeToAll(16);

    expect(term1.options.fontSize).toBe(16);
    expect(term2.options.fontSize).toBe(16);
    expect(fit1.fit).toHaveBeenCalledOnce();
    expect(fit2.fit).toHaveBeenCalledOnce();
    expect(invokeFn).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when no terminals are cached', () => {
    // Should not throw
    applyFontSizeToAll(18);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
