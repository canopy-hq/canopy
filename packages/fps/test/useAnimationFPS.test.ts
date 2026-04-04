import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnimationFPS, HISTORY_SIZE } from '../src/useAnimationFPS';

// ─── rAF mock ──────────────────────────────────────────────────────────────────

let rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;

function flushFrame(now: number) {
  const pending = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  for (const [, cb] of pending) cb(now);
}

beforeEach(() => {
  rafCallbacks.clear();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Fire N evenly-spaced frames at the target fps, starting from `startMs`. */
function fireFrames(count: number, fps: number, startMs = 0) {
  const interval = 1000 / fps;
  for (let i = 0; i < count; i++) {
    flushFrame(startMs + i * interval);
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useAnimationFPS', () => {
  it('returns fps=0 and empty history before any frames', () => {
    const { result } = renderHook(() => useAnimationFPS());
    expect(result.current.fps).toBe(0);
    expect(result.current.history).toEqual([]);
  });

  it('does not update state before UPDATE_INTERVAL_MS has elapsed', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      // Two frames 10ms apart — not enough time to trigger an update (needs ≥ 250ms)
      flushFrame(0);
      flushFrame(10);
    });

    expect(result.current.fps).toBe(0);
  });

  it('computes fps correctly at 60fps', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      // 30 frames at 60fps spans 483ms — crosses the 250ms update threshold
      fireFrames(30, 60);
    });

    expect(result.current.fps).toBe(60);
  });

  it('computes fps correctly at 30fps', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      fireFrames(20, 30); // 633ms at 30fps
    });

    expect(result.current.fps).toBe(30);
  });

  it('accumulates history entries over time', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      // Continuous stream — no gaps between frames so every sample is exactly 60fps
      fireFrames(100, 60, 0);
    });

    expect(result.current.history.length).toBeGreaterThan(1);
    expect(result.current.history.every((v) => v === 60)).toBe(true);
  });

  it('caps history at HISTORY_SIZE entries', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      // Produce far more history entries than HISTORY_SIZE
      for (let i = 0; i <= HISTORY_SIZE + 50; i++) {
        fireFrames(20, 60, i * 400);
      }
    });

    expect(result.current.history.length).toBeLessThanOrEqual(HISTORY_SIZE);
  });

  it('cancels the rAF loop on unmount', () => {
    const { unmount } = renderHook(() => useAnimationFPS());

    // At least one rAF should be pending after mount
    expect(rafCallbacks.size).toBeGreaterThan(0);

    unmount();

    expect(rafCallbacks.size).toBe(0);
  });

  it('pauses the rAF loop when the page becomes hidden', () => {
    const { result } = renderHook(() => useAnimationFPS());

    act(() => {
      fireFrames(30, 60);
    });

    const fpsBefore = result.current.fps;
    expect(fpsBefore).toBe(60);

    // Simulate page becoming hidden
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // rAF loop should have stopped — no more pending callbacks
    expect(rafCallbacks.size).toBe(0);

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('resumes the rAF loop when the page becomes visible again', () => {
    const { result } = renderHook(() => useAnimationFPS());

    // Hide the page
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(rafCallbacks.size).toBe(0);

    // Show the page again
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(rafCallbacks.size).toBeGreaterThan(0);

    // Confirm fps updates after resume
    act(() => {
      fireFrames(30, 60);
    });

    expect(result.current.fps).toBe(60);
  });
});
