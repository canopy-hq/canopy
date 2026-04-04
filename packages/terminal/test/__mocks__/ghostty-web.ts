import { vi } from 'vitest';

export function createGhosttyWebMock() {
  const Terminal = vi.fn().mockImplementation(function (this: any) {
    this.element = null as HTMLElement | null;
    this.rows = 24;
    this.cols = 80;
    this.loadAddon = vi.fn();
    this.open = vi.fn((el: HTMLElement) => {
      this.element = el;
    });
    this.write = vi.fn();
    this.focus = vi.fn();
    this.blur = vi.fn();
    this.dispose = vi.fn();
    this.reset = vi.fn();
    this.resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    this.onData = vi.fn();
    this.onResize = vi.fn();
    this.attachCustomKeyEventHandler = vi.fn();
  });

  const FitAddon = vi.fn().mockImplementation(function (this: any) {
    this.fit = vi.fn();
    this.dispose = vi.fn();
    this.proposeDimensions = vi.fn(() => ({ rows: 24, cols: 80 }));
  });

  return { Terminal, FitAddon, init: vi.fn().mockResolvedValue(undefined) };
}
