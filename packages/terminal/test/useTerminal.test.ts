import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('ghostty-web', async () => {
  const { createGhosttyWebMock } = await import('./__mocks__/ghostty-web');
  return createGhosttyWebMock();
});

vi.mock('@superagent/db', async () => {
  const { createDbMock } = await import('./__mocks__/superagent-db');
  return createDbMock();
});

vi.mock('../src/ghostty-init', () => ({
  ensureGhosttyInit: vi.fn().mockResolvedValue(undefined),
  isGhosttyReady: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/pty', () => ({
  spawnTerminal: vi.fn().mockResolvedValue({ ptyId: 42, isNew: true }),
  connectPtyOutput: vi.fn(),
  writeToPty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  getPtyCwd: vi.fn().mockResolvedValue('/home/user'),
}));

vi.mock('../src/terminal-cache', () => ({
  getCached: vi.fn(() => undefined),
  setCached: vi.fn(),
  disposeCached: vi.fn(),
  getAllCached: vi.fn(() => new Map()),
}));

// ─── Imports (after mocks are registered) ────────────────────────────────────

import { Terminal, FitAddon } from 'ghostty-web';

import { connectPtyOutput, resizePty, spawnTerminal, writeToPty } from '../src/pty';
import { getCached, setCached } from '../src/terminal-cache';
import { useTerminal } from '../src/useTerminal';
// ─── Helpers ─────────────────────────────────────────────────────────────────
import { flushPromises, makeContainer } from './helpers';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(spawnTerminal).mockResolvedValue({ ptyId: 42, isNew: true });
  vi.mocked(getCached).mockReturnValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — Regression guards (must PASS on current main code)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useTerminal — spawn path (ptyId === -1)', () => {
  it('calls spawnTerminal with paneId and savedCwd after WASM is ready', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-abc', '/workspace', -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(spawnTerminal).toHaveBeenCalledWith(
      'pane-abc',
      '/workspace',
      expect.any(Number),
      expect.any(Number),
    );
    unmount();
  });

  it('calls connectPtyOutput after spawn resolves', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));
    unmount();
  });

  it('calls onPtySpawned with the returned ptyId', async () => {
    const container = makeContainer();
    const onPtySpawned = vi.fn();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, onPtySpawned),
    );
    await act(flushPromises);

    expect(onPtySpawned).toHaveBeenCalledWith(42);
    unmount();
  });

  it('overlay present before the first live byte', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    expect(wrapper.childElementCount).toBeGreaterThan(0);
    const overlay = wrapper.firstElementChild as HTMLElement;
    expect(overlay.style.position).toBe('absolute');
    unmount();
  });

  it('overlay removed after single rAF following FIRST byte (one-shot)', async () => {
    vi.useFakeTimers();
    // happy-dom's rAF uses setImmediate which fake timers don't control;
    // replace with setTimeout(cb, 0) so vi.advanceTimersByTime flushes them.
    const origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number;

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    const overlay = wrapper.firstElementChild as HTMLElement;

    const freshHandler = vi.mocked(connectPtyOutput).mock.calls[0]![1];

    // First byte: schedules one-shot rAF, overlay still present
    act(() => {
      freshHandler(new Uint8Array([65]));
    });
    expect(overlay.parentNode).not.toBeNull();

    // rAF fires → removeOverlay()
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(overlay.parentNode).toBeNull();

    globalThis.requestAnimationFrame = origRAF;
    vi.useRealTimers();
    unmount();
  });

  it('unmount before spawn resolves cancels — connectPtyOutput not called', async () => {
    let resolveSpawn!: (result: { ptyId: number; isNew: boolean }) => void;
    vi.mocked(spawnTerminal).mockReturnValueOnce(
      new Promise<{ ptyId: number; isNew: boolean }>((resolve) => {
        resolveSpawn = resolve;
      }),
    );

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    unmount();

    await act(async () => {
      resolveSpawn({ ptyId: 99, isNew: true });
      await flushPromises();
    });

    expect(connectPtyOutput).not.toHaveBeenCalled();
  });

  it('setCached called with the new ptyId after spawn', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(setCached).toHaveBeenCalledWith(42, expect.anything(), expect.anything());
    unmount();
  });

  it('typing works after spawn (ptrRef.ptyId set to newId)', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const onDataCb = termInstance.onData.mock.calls[0]?.[0];
    expect(onDataCb).toBeDefined();
    onDataCb('a');

    expect(vi.mocked(writeToPty)).toHaveBeenCalledWith(42, 'a');
    unmount();
  });
});

describe('useTerminal — reconnect path (ptyId > 0)', () => {
  it('calls connectPtyOutput with the given ptyId', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 5, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(5, expect.any(Function));
    expect(spawnTerminal).not.toHaveBeenCalled();
    unmount();
  });

  it('overlay removed synchronously after connectPtyOutput (buffer has scrollback, safe to reveal immediately)', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 5, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(5, expect.any(Function));

    // Overlay removed synchronously — no data needed
    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    expect(wrapper.querySelector('[style*="z-index"]')).toBeNull();
    unmount();
  });
});

describe('useTerminal — cached remount path', () => {
  it('reuses the cached Terminal instance — new Terminal() is NOT called', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');
    document.body.appendChild(termA.element);

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { result, unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(vi.mocked(Terminal)).not.toHaveBeenCalled();
    expect(result.current.current).toBe(termA);
    unmount();
  });

  it('appends the cached terminal element to the container', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    const cachedEl = document.createElement('div');
    termA.element = cachedEl;
    document.body.appendChild(cachedEl);

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(container.contains(cachedEl)).toBe(true);
    unmount();
  });

  it('calls fitAddon.fit() to restore dimensions', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(fitA.fit).toHaveBeenCalled();
    unmount();
  });

  it('uses connectPtyOutput on cached remount', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(7, expect.any(Function));
    unmount();
  });

  it('does NOT call setCached again', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(setCached).not.toHaveBeenCalled();
    unmount();
  });

  it('calls resizePty to sync PTY dimensions on remount', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 7, false, vi.fn()),
    );
    await act(flushPromises);

    expect(vi.mocked(resizePty)).toHaveBeenCalledWith(7, termA.rows, termA.cols);
    unmount();
  });
});

describe('useTerminal — useLayoutEffect resize on ptyId transition', () => {
  it('calls resizePty in the layout phase when ptyId > 0 and cache is populated', async () => {
    const termA = new (vi.mocked(Terminal) as any)() as any;
    const fitA = new (vi.mocked(FitAddon) as any)() as any;
    termA.element = document.createElement('div');

    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue({ term: termA, fitAddon: fitA });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 42, false, vi.fn()),
    );
    await act(flushPromises);

    // resizePty must have been called at least once — either from useLayoutEffect
    // or the direct call in the cached useEffect path (both are valid triggers).
    expect(vi.mocked(resizePty)).toHaveBeenCalledWith(42, termA.rows, termA.cols);
    unmount();
  });

  it('does NOT call resizePty in layout phase when ptyId is -1', async () => {
    vi.clearAllMocks();
    vi.mocked(getCached).mockReturnValue(undefined);

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    // Don't flush promises — we only care about the layout-phase check, not spawn.
    // resizePty should NOT be called at this point (ptyId is -1).
    expect(vi.mocked(resizePty)).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useTerminal — full spawn → unmount → remount cycle', () => {
  it('remount reuses the spawned terminal without a new spawn', async () => {
    const cachedTerms = new Map<number, { term: any; fitAddon: any }>();
    vi.mocked(setCached).mockImplementation((id, term, fitAddon) => {
      cachedTerms.set(id, { term, fitAddon });
    });
    vi.mocked(getCached).mockImplementation((id) => cachedTerms.get(id));

    const container1 = makeContainer();
    const hook1 = renderHook(() =>
      useTerminal({ current: container1 } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(setCached).toHaveBeenCalledWith(42, expect.anything(), expect.anything());
    const spawnedTerm = cachedTerms.get(42)!.term;
    hook1.unmount();

    vi.clearAllMocks();
    vi.mocked(getCached).mockImplementation((id) => cachedTerms.get(id));

    const container2 = makeContainer();
    const hook2 = renderHook(() =>
      useTerminal({ current: container2 } as any, 'pane-1', undefined, 42, false, vi.fn()),
    );
    await act(flushPromises);

    expect(hook2.result.current.current).toBe(spawnedTerm);
    expect(spawnTerminal).not.toHaveBeenCalled();
    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));

    hook2.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Bug-specific tests (FAIL on main, PASS after fix)
//
// These tests mock spawnTerminal to return { ptyId, isNew } instead of number.
// On the current main code, .then((newId) => ...) receives the object as newId,
// causing ptrRef.ptyId = { ptyId: 42, isNew: false } (an object, not a number).
// The tests below verify the CORRECT behavior after the fix is applied.
// ═══════════════════════════════════════════════════════════════════════════════

describe('useTerminal — restored session (isNew=false) [PHASE 2]', () => {
  it('uses connectPtyOutput for restored sessions', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));
    unmount();
  });

  it('overlay removed synchronously for restored sessions (buffer has scrollback when setHandler runs)', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));

    // Overlay removed synchronously after connectPtyOutput
    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    expect(wrapper.querySelector('[style*="z-index"]')).toBeNull();
    unmount();
  });

  it('typing works for restored sessions', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const onDataCb = termInstance.onData.mock.calls[0]?.[0];
    expect(onDataCb).toBeDefined();
    onDataCb('a');

    expect(vi.mocked(writeToPty)).toHaveBeenCalledWith(42, 'a');
    unmount();
  });

  it('fresh session (isNew=true) uses connectPtyOutput with debouncedRemoveOverlay in handler', async () => {
    vi.useFakeTimers();
    const origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number;

    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: true });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));

    // Overlay still present until first byte triggers the debounce
    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    const overlay = wrapper.firstElementChild as HTMLElement;
    expect(overlay.style.position).toBe('absolute');

    // Simulate first byte → one-shot 80ms timer fires → overlay removed
    const handler = vi.mocked(connectPtyOutput).mock.calls[0]![1];
    act(() => {
      handler(new Uint8Array([65]));
    });
    act(() => {
      vi.advanceTimersByTime(80);
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(1);
    });
    expect(overlay.parentNode).toBeNull();

    globalThis.requestAnimationFrame = origRAF;
    vi.useRealTimers();
    unmount();
  });
});
