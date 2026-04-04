import { vi } from 'vitest';

export function createDbMock() {
  return {
    getSettingCollection: vi.fn<() => { toArray: never[] }>(() => ({ toArray: [] })),
    getSetting: vi.fn<(_arr: unknown, _key: string, fallback: unknown) => unknown>(
      (_arr, _key, fallback) => fallback,
    ),
    setSetting: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}
