import { describe, it, expect, vi } from 'vitest';

// Mock Tauri IPC -- xterm.js requires DOM APIs not available in jsdom,
// so we test the component renders without crashing and calls the hook.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
}));

// Mock xterm.js -- jsdom lacks WebGL context
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onBinary: vi.fn(),
    dispose: vi.fn(),
    rows: 24,
    cols: 80,
  })),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(),
}));

describe('Terminal', () => {
  it('placeholder -- renders without error', () => {
    // Will be implemented after Terminal.tsx exists
    expect(true).toBe(true);
  });
});
