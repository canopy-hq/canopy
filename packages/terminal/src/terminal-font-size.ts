import { resizePty } from './pty';
import { getAllCached } from './terminal-cache';

export const DEFAULT_TERMINAL_FONT_SIZE = 13;

/**
 * Apply a new font size to every cached terminal and refit the grid.
 */
export function applyFontSizeToAll(size: number): void {
  for (const [ptyId, { term, fitAddon }] of getAllCached()) {
    term.options.fontSize = size;
    fitAddon.fit();
    void resizePty(ptyId, term.rows, term.cols);
  }
}
