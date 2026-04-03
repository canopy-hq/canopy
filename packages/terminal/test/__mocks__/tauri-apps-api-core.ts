import { vi } from 'vitest';

export function createTauriCoreMock() {
  const invoke = vi.fn().mockResolvedValue(undefined);

  class Channel<T = unknown> {
    onmessage: ((data: T) => void) | null = null;
  }

  return { invoke, Channel };
}
