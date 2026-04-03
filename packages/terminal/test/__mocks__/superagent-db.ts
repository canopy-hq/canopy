import { vi } from 'vitest';

export function createDbMock() {
  return {
    getSettingCollection: vi.fn(() => ({ toArray: [] })),
    getSetting: vi.fn((_arr: unknown, _key: string, fallback: unknown) => fallback),
    setSetting: vi.fn().mockResolvedValue(undefined),
  };
}
