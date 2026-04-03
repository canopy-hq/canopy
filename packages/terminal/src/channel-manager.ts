/**
 * Sentinel-aware output channel state machine.
 *
 * The daemon sends PTY output in two phases per `attach` call:
 *   1. Scrollback replay — accumulated history (may be large, e.g. a previous Claude Code session)
 *   2. Sentinel         — a zero-length frame (rawData.length === 0) marking "end of replay"
 *   3. Live data        — fresh PTY output from the running shell
 *
 * Two wiring modes:
 *
 * setHandler (reconnect path):
 *   Flushes buffered scrollback to the handler immediately — the user wants to
 *   see their previous session. Subsequent data (sentinel, live) is forwarded as-is
 *   (sentinel is silently dropped; it is a protocol detail, not terminal content).
 *
 * setHandlerFresh (new spawn path):
 *   Discards any buffered pre-handler data. Then buffers all data that arrives
 *   after the handler is set but before the sentinel — this is still scrollback
 *   replay that the user must never see. When the sentinel arrives the buffer is
 *   discarded. Only post-sentinel (live) data is forwarded to the handler.
 *
 * This guarantees that `handler(bytes)` is called only with live data for new
 * spawns, making the overlay mechanism work correctly: the overlay is removed
 * on the first live byte, never on stale scrollback.
 */

export interface ChannelEntry {
  /** Called by the Tauri Channel.onmessage for every incoming frame. */
  onData(rawData: number[]): void;
  /** Wire handler and flush scrollback (reconnect path). */
  setHandler(h: (data: Uint8Array) => void): void;
  /** Wire handler, discard scrollback, wait for sentinel (spawn path). */
  setHandlerFresh(h: (data: Uint8Array) => void): void;
}

export function createChannelEntry(): ChannelEntry {
  const preHandlerBuffer: Uint8Array[] = [];
  const postHandlerBuffer: Uint8Array[] = [];
  let handler: ((data: Uint8Array) => void) | null = null;
  let freshMode = false;
  let sentinelReceived = false;

  return {
    onData(rawData) {
      if (rawData.length === 0) {
        // Sentinel: end of scrollback replay.
        sentinelReceived = true;
        if (freshMode) postHandlerBuffer.length = 0;
        return;
      }
      const bytes = new Uint8Array(rawData);
      if (!handler) {
        preHandlerBuffer.push(bytes);
      } else if (freshMode && !sentinelReceived) {
        // Post-handler but pre-sentinel: still scrollback — buffer and discard.
        postHandlerBuffer.push(bytes);
      } else {
        handler(bytes);
      }
    },

    setHandler(h) {
      freshMode = false;
      handler = h;
      for (const b of preHandlerBuffer) h(b);
      preHandlerBuffer.length = 0;
    },

    setHandlerFresh(h) {
      freshMode = true;
      preHandlerBuffer.length = 0;
      // If the sentinel already arrived before we wired the handler, all buffered
      // data was scrollback (now discarded). Go straight to live-forwarding mode.
      if (sentinelReceived) freshMode = false;
      handler = h;
    },
  };
}
