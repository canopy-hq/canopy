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
}));

vi.mock('../src/pty', () => ({
  spawnTerminal: vi.fn().mockResolvedValue({ ptyId: 42, isNew: true }),
  connectPtyOutput: vi.fn(),
  connectPtyOutputFresh: vi.fn(),
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
import {
  connectPtyOutput,
  connectPtyOutputFresh,
  spawnTerminal,
} from '../src/pty';
import { getCached, setCached } from '../src/terminal-cache';
import { useTerminal } from '../src/useTerminal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { flushPromises, makeContainer } from './helpers';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults cleared by clearAllMocks.
  vi.mocked(spawnTerminal).mockResolvedValue({ ptyId: 42, isNew: true });
  vi.mocked(getCached).mockReturnValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useTerminal — spawn path (ptyId === -1)', () => {
  it('calls spawnTerminal with paneId and savedCwd after WASM is ready', async () => {
    const container = makeContainer();
    const containerRef = { current: container };
    const onPtySpawned = vi.fn();

    const { unmount } = renderHook(() =>
      useTerminal(containerRef as any, 'pane-abc', '/workspace', -1, false, onPtySpawned),
    );

    await act(flushPromises);

    expect(spawnTerminal).toHaveBeenCalledWith('pane-abc', '/workspace', expect.any(Number), expect.any(Number));
    unmount();
  });

  it('calls connectPtyOutputFresh after spawn resolves', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    expect(connectPtyOutputFresh).toHaveBeenCalledWith(42, expect.any(Function));
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

  it('overlay div is present before the first live byte', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    expect(wrapper).toBeTruthy();

    // The mock term.open() doesn't add DOM children, so the only child of wrapper is the overlay.
    // Verify it has position:absolute (happy-dom may normalize style.cssText so we check properties).
    expect(wrapper.childElementCount).toBeGreaterThan(0);
    const overlay = wrapper.firstElementChild as HTMLElement;
    expect(overlay.style.position).toBe('absolute');

    unmount();
  });

  it('overlay is removed on the first live byte via connectPtyOutputFresh', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    const overlay = wrapper.firstElementChild as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe('absolute');

    // Simulate the first live byte arriving through the fresh handler
    const freshHandler = vi.mocked(connectPtyOutputFresh).mock.calls[0]![1];
    act(() => {
      freshHandler(new Uint8Array([65])); // 'A'
    });

    expect(overlay.parentNode).toBeNull();
    unmount();
  });

  it('unmounting before spawn resolves cancels the spawn — connectPtyOutputFresh is not called', async () => {
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

    await act(flushPromises); // WASM ready, spawn issued, not yet resolved

    unmount(); // cleanup fires, spawnCancelled = true

    await act(async () => {
      resolveSpawn({ ptyId: 99, isNew: true });
      await flushPromises();
    });

    expect(connectPtyOutputFresh).not.toHaveBeenCalled();
  });

  it('calls setCached with the new ptyId after spawn', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    expect(setCached).toHaveBeenCalledWith(42, expect.anything(), expect.anything());
    unmount();
  });

  it('overlay still present after spawn when isNew=true (waiting for first live byte)', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    const overlay = wrapper.firstElementChild as HTMLElement;
    // Overlay must still be present — awaiting the first post-sentinel live byte.
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe('absolute');
    unmount();
  });

  it('overlay removed on first data byte when isNew=false', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    // Overlay still present — SIGWINCH hasn't fired yet (waiting for first byte).
    const overlay = wrapper.firstElementChild as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe('absolute');

    // Simulate first byte arriving via connectPtyOutput handler
    const outputHandler = vi.mocked(connectPtyOutput).mock.calls[0]![1];
    act(() => {
      outputHandler(new Uint8Array([65])); // 'A'
    });

    expect(overlay.parentNode).toBeNull();
    unmount();
  });

  it('calls resizePty immediately for isNew=false (before onPtySpawned re-render cancels sigwinchTimer)', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    const { resizePty } = await import('../src/pty');
    expect(vi.mocked(resizePty)).toHaveBeenCalledWith(42, expect.any(Number), expect.any(Number));
    unmount();
  });

  it('uses connectPtyOutput (not connectPtyOutputFresh) when isNew=false', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ ptyId: 42, isNew: false });

    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );

    await act(flushPromises);

    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));
    expect(connectPtyOutputFresh).not.toHaveBeenCalled();
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

  it('does NOT call connectPtyOutputFresh (no overlay for reconnect)', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 5, false, vi.fn()),
    );

    await act(flushPromises);

    expect(connectPtyOutputFresh).not.toHaveBeenCalled();
    unmount();
  });

  it('overlay is removed immediately without waiting for data', async () => {
    const container = makeContainer();
    const { unmount } = renderHook(() =>
      useTerminal({ current: container } as any, 'pane-1', undefined, 5, false, vi.fn()),
    );

    await act(flushPromises);

    const termInstance = vi.mocked(Terminal).mock.instances[0] as any;
    const wrapper = termInstance.element as HTMLElement;
    // Overlay should be gone — no data needed to remove it on reconnect path.
    const overlay = wrapper.firstElementChild as HTMLElement | null;
    expect(overlay === null || overlay.style.position !== 'absolute').toBe(true);
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

    // No new Terminal was constructed
    expect(vi.mocked(Terminal)).not.toHaveBeenCalled();
    // Hook ref points to the same instance
    expect(result.current.current).toBe(termA);
    unmount();
  });

  it('appends the cached terminal element (same DOM node) to the container', async () => {
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

    // Exact same node, not a clone
    expect(container.contains(cachedEl)).toBe(true);
    expect(container.firstChild).toBe(cachedEl);
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

  it('uses connectPtyOutput (reconnect path) — not connectPtyOutputFresh', async () => {
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
    expect(connectPtyOutputFresh).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT call setCached again (no overwrite of the existing entry)', async () => {
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
});

describe('useTerminal — full spawn → unmount → remount cycle', () => {
  it('remount reuses the spawned terminal without a new spawn', async () => {
    const cachedTerms = new Map<number, { term: any; fitAddon: any }>();
    vi.mocked(setCached).mockImplementation((id, term, fitAddon) => {
      cachedTerms.set(id, { term, fitAddon });
    });
    vi.mocked(getCached).mockImplementation((id) => cachedTerms.get(id));

    // First mount — spawn path
    const container1 = makeContainer();
    const hook1 = renderHook(() =>
      useTerminal({ current: container1 } as any, 'pane-1', undefined, -1, false, vi.fn()),
    );
    await act(flushPromises);

    expect(setCached).toHaveBeenCalledWith(42, expect.anything(), expect.anything());
    const spawnedTerm = cachedTerms.get(42)!.term;

    hook1.unmount();

    // Second mount — remount with the returned ptyId
    vi.clearAllMocks();
    vi.mocked(getCached).mockImplementation((id) => cachedTerms.get(id));

    const container2 = makeContainer();
    const hook2 = renderHook(() =>
      useTerminal({ current: container2 } as any, 'pane-1', undefined, 42, false, vi.fn()),
    );
    await act(flushPromises);

    // Same terminal instance reused
    expect(hook2.result.current.current).toBe(spawnedTerm);
    // No new spawn
    expect(spawnTerminal).not.toHaveBeenCalled();
    // Reconnect path used (not fresh)
    expect(connectPtyOutput).toHaveBeenCalledWith(42, expect.any(Function));
    expect(connectPtyOutputFresh).not.toHaveBeenCalled();

    hook2.unmount();
  });
});
