import { vi } from 'vitest';

export function createGhosttyWebMock() {
  const Terminal = vi.fn<() => void>().mockImplementation(function (this: any) {
    this.element = null as HTMLElement | null;
    this.rows = 24;
    this.cols = 80;
    this.loadAddon = vi.fn<() => void>();
    this.open = vi.fn<(el: HTMLElement) => void>((el: HTMLElement) => {
      this.element = el;
    });
    this.write = vi.fn<() => void>();
    this.focus = vi.fn<() => void>();
    this.blur = vi.fn<() => void>();
    this.dispose = vi.fn<() => void>();
    this.reset = vi.fn<() => void>();
    this.resize = vi.fn<(cols: number, rows: number) => void>((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    this.onData = vi.fn<() => void>();
    this.onResize = vi.fn<() => void>();
    this.attachCustomKeyEventHandler = vi.fn<() => void>();
  });

  const FitAddon = vi.fn<() => void>().mockImplementation(function (this: any) {
    this.fit = vi.fn<() => void>();
    this.dispose = vi.fn<() => void>();
    this.proposeDimensions = vi.fn<() => { rows: number; cols: number }>(() => ({
      rows: 24,
      cols: 80,
    }));
  });

  return { Terminal, FitAddon, init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}
