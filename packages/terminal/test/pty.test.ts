import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('pty', () => {
  // outputRegistry is module-level state — reset modules between tests.
  let pty: typeof import('../src/pty');
  let invokeFn: ReturnType<typeof vi.fn>;
  let MockChannel: { new (): { onmessage: ((data: number[]) => void) | null } };
  let mockEntry: {
    onData: ReturnType<typeof vi.fn>;
    setHandler: ReturnType<typeof vi.fn>;
    setHandlerFresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();

    invokeFn = vi.fn().mockResolvedValue(undefined);
    MockChannel = class {
      onmessage: ((data: number[]) => void) | null = null;
    };
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeFn, Channel: MockChannel }));

    mockEntry = { onData: vi.fn(), setHandler: vi.fn(), setHandlerFresh: vi.fn() };
    vi.doMock('../src/channel-manager', () => ({ createChannelEntry: vi.fn(() => mockEntry) }));

    pty = await import('../src/pty');
  });

  describe('spawnTerminal — concurrent dedup', () => {
    it('concurrent calls for the same pane share one promise (one invoke)', async () => {
      invokeFn.mockResolvedValue({ pty_id: 10, is_new: true });
      const [r1, r2] = await Promise.all([
        pty.spawnTerminal('pane-concurrent'),
        pty.spawnTerminal('pane-concurrent'),
      ]);
      expect(invokeFn).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(r2);
      expect(r1).toEqual({ ptyId: 10, isNew: true });
    });

    it('concurrent calls wire the same channel entry', async () => {
      invokeFn.mockResolvedValue({ pty_id: 11, is_new: true });
      await Promise.all([
        pty.spawnTerminal('pane-entry-share'),
        pty.spawnTerminal('pane-entry-share'),
      ]);
      // Both callers share one entry — connectPtyOutput should reach it
      const handler = vi.fn();
      pty.connectPtyOutput(11, handler);
      expect(mockEntry.setHandler).toHaveBeenCalledTimes(1);
    });

    it('serial calls (second after first resolves) each invoke independently', async () => {
      invokeFn.mockResolvedValue({ pty_id: 20, is_new: true });
      await pty.spawnTerminal('pane-serial');

      invokeFn.mockClear();
      invokeFn.mockResolvedValue({ pty_id: 20, is_new: false });
      await pty.spawnTerminal('pane-serial');

      expect(invokeFn).toHaveBeenCalledWith(
        'spawn_terminal',
        expect.objectContaining({ paneId: 'pane-serial' }),
      );
    });

    it('different panes always invoke independently', async () => {
      invokeFn.mockResolvedValue({ pty_id: 30, is_new: true });
      await Promise.all([pty.spawnTerminal('pane-A'), pty.spawnTerminal('pane-B')]);
      expect(invokeFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('spawnTerminal', () => {
    it('calls spawn_terminal and returns the ptyId from invoke', async () => {
      invokeFn.mockResolvedValueOnce({ pty_id: 42, is_new: true });
      const result = await pty.spawnTerminal('pane-1', '/home/user', 24, 80);
      expect(invokeFn).toHaveBeenCalledWith('spawn_terminal', {
        paneId: 'pane-1',
        cwd: '/home/user',
        rows: 24,
        cols: 80,
        onOutput: expect.any(MockChannel),
      });
      expect(result).toEqual({ ptyId: 42, isNew: true });
    });

    it('registers the channel entry in the output registry', async () => {
      invokeFn.mockResolvedValueOnce({ pty_id: 7, is_new: true });
      await pty.spawnTerminal('pane-1');
      // Verify by confirming connectPtyOutput can reach the entry
      const handler = vi.fn();
      pty.connectPtyOutput(7, handler);
      expect(mockEntry.setHandler).toHaveBeenCalledWith(handler);
    });

    it('wires channel.onmessage to entry.onData', async () => {
      invokeFn.mockResolvedValueOnce({ pty_id: 99, is_new: true });
      await pty.spawnTerminal('pane-1');
      // Find the Channel instance passed to invoke
      const channelArg = invokeFn.mock.calls[0][1].onOutput as {
        onmessage: ((data: number[]) => void) | null;
      };
      expect(channelArg.onmessage).not.toBeNull();
      const testData = [1, 2, 3];
      channelArg.onmessage!(testData);
      expect(mockEntry.onData).toHaveBeenCalledWith(testData);
    });
  });

  describe('connectPtyOutput', () => {
    it('calls setHandler on the correct channel entry', async () => {
      invokeFn.mockResolvedValueOnce({ pty_id: 5, is_new: true });
      await pty.spawnTerminal('pane-1');
      const handler = vi.fn();
      pty.connectPtyOutput(5, handler);
      expect(mockEntry.setHandler).toHaveBeenCalledWith(handler);
    });

    it('is a silent no-op for an unknown ptyId (optional chaining)', () => {
      // No spawn — ptyId 404 was never registered
      expect(() => pty.connectPtyOutput(404, vi.fn())).not.toThrow();
    });
  });

  describe('writeToPty', () => {
    it('encodes the string to bytes and invokes write_to_pty', async () => {
      await pty.writeToPty(1, 'hello');
      expect(invokeFn).toHaveBeenCalledWith('write_to_pty', {
        ptyId: 1,
        data: Array.from(new TextEncoder().encode('hello')),
      });
    });
  });

  describe('resizePty', () => {
    it('invokes resize_pty with correct dimensions', async () => {
      await pty.resizePty(2, 30, 120);
      expect(invokeFn).toHaveBeenCalledWith('resize_pty', { ptyId: 2, rows: 30, cols: 120 });
    });
  });

  describe('closePty', () => {
    it('invokes close_pty and removes the entry from the registry', async () => {
      invokeFn.mockResolvedValueOnce({ pty_id: 8, is_new: true });
      await pty.spawnTerminal('pane-1');

      invokeFn.mockResolvedValueOnce(undefined);
      await pty.closePty(8);

      expect(invokeFn).toHaveBeenCalledWith('close_pty', { ptyId: 8 });
      // Entry should no longer be in the registry
      pty.connectPtyOutput(8, vi.fn());
      expect(mockEntry.setHandler).not.toHaveBeenCalled();
    });
  });

  describe('getPtyCwd', () => {
    it('invokes get_pty_cwd and returns the string result', async () => {
      invokeFn.mockResolvedValueOnce('/tmp/work');
      const cwd = await pty.getPtyCwd('pane-abc');
      expect(invokeFn).toHaveBeenCalledWith('get_pty_cwd', { paneId: 'pane-abc' });
      expect(cwd).toBe('/tmp/work');
    });
  });

  describe('initTerminalPool', () => {
    it('invokes init_terminal_pool with the given cwd', async () => {
      invokeFn.mockResolvedValueOnce(undefined);
      await pty.initTerminalPool('/Users/test/project');
      expect(invokeFn).toHaveBeenCalledWith('init_terminal_pool', { cwd: '/Users/test/project' });
    });
  });

  describe('closePtysForPanes', () => {
    it('invokes close_ptys_for_panes with the given pane IDs', async () => {
      invokeFn.mockResolvedValueOnce(undefined);
      await pty.closePtysForPanes(['pane-a', 'pane-b']);
      expect(invokeFn).toHaveBeenCalledWith('close_ptys_for_panes', {
        paneIds: ['pane-a', 'pane-b'],
      });
    });

    it('skips invoke for empty array', async () => {
      await pty.closePtysForPanes([]);
      expect(invokeFn).not.toHaveBeenCalled();
    });
  });

  describe('spawnTerminal — error handling', () => {
    it('rejects and clears pendingSpawns so retries work', async () => {
      invokeFn.mockRejectedValueOnce(new Error('daemon down'));
      await expect(pty.spawnTerminal('pane-err')).rejects.toThrow('daemon down');

      // A subsequent call should attempt a fresh invoke, not return the failed promise
      invokeFn.mockResolvedValueOnce({ pty_id: 50, is_new: true });
      const result = await pty.spawnTerminal('pane-err');
      expect(result).toEqual({ ptyId: 50, isNew: true });
      expect(invokeFn).toHaveBeenCalledTimes(2);
    });
  });
});
