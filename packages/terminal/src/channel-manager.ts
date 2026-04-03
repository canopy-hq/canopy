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
  // Post-sentinel, pre-handler: live bytes that arrived before the handler was wired.
  // Always flushed — these are the shell prompt the user is waiting for.
  const postSentinelBuffer: Uint8Array[] = [];
  let handler: ((data: Uint8Array) => void) | null = null;
  let freshMode = false;
  let sentinelReceived = false;

  function drain(buf: Uint8Array[], h: (d: Uint8Array) => void) {
    for (const b of buf) h(b);
    buf.length = 0;
  }

  return {
    onData(rawData) {
      if (rawData.length === 0) {
        // Sentinel: end of scrollback replay.
        sentinelReceived = true;
        return;
      }
      const bytes = new Uint8Array(rawData);
      if (!handler) {
        // Split on sentinel boundary so setHandlerFresh can discard scrollback
        // while preserving live bytes (e.g. the initial shell prompt).
        if (sentinelReceived) {
          postSentinelBuffer.push(bytes);
        } else {
          preHandlerBuffer.push(bytes);
        }
      } else if (freshMode && !sentinelReceived) {
        // Post-handler but pre-sentinel: still scrollback — drop it.
      } else {
        handler(bytes);
      }
    },

    setHandler(h) {
      freshMode = false;
      handler = h;
      drain(preHandlerBuffer, h);
      drain(postSentinelBuffer, h);
    },

    setHandlerFresh(h) {
      freshMode = true;
      preHandlerBuffer.length = 0;
      if (sentinelReceived) {
        // Sentinel already arrived before handler wired: skip fresh-mode buffering
        // and flush any live bytes (shell prompt) that arrived in the gap.
        freshMode = false;
        handler = h;
        drain(postSentinelBuffer, h);
      } else {
        handler = h;
      }
    },
  };
}
