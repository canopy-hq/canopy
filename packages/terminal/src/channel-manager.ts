/**
 * PTY output buffer.
 *
 * Rust's `spawn_terminal` command waits for the daemon sentinel (end-of-scrollback
 * marker) before returning. When the Tauri invoke resolves on the TypeScript side,
 * this entry is guaranteed to hold the full scrollback replay. TypeScript does not
 * need to track the sentinel — it is simply ignored here.
 *
 * setHandler: Flush buffered scrollback to the handler immediately, then hand off.
 */

export interface ChannelEntry {
  /** Called by the Tauri Channel.onmessage for every incoming frame. */
  onData(rawData: number[]): void;
  /** Wire handler and flush buffered scrollback. */
  setHandler(h: (data: Uint8Array) => void): void;
}

export function createChannelEntry(): ChannelEntry {
  const buffer: Uint8Array[] = [];
  let handler: ((data: Uint8Array) => void) | null = null;

  return {
    onData(rawData) {
      if (rawData.length === 0) return; // sentinel — handled by Rust, ignored here
      const bytes = new Uint8Array(rawData);
      if (handler) handler(bytes);
      else buffer.push(bytes);
    },

    setHandler(h) {
      handler = h;
      for (const chunk of buffer) h(chunk);
      buffer.length = 0;
    },
  };
}
