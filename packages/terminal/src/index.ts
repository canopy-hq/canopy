export { useTerminal } from './useTerminal';
export {
  spawnTerminal,
  connectPtyOutput,
  writeToPty,
  resizePty,
  closePty,
  closePtysForPanes,
  getPtyCwd,
  listPtySessions,
  type PtySessionInfo,
} from './pty';
export {
  getCached,
  setCached,
  disposeCached,
  getAllCached,
  type CachedEntry,
} from './terminal-cache';
export { applyFontSizeToAll, DEFAULT_TERMINAL_FONT_SIZE } from './terminal-font-size';
export { ensureGhosttyInit, isGhosttyReady } from './ghostty-init';
export {
  themes,
  themeNames,
  terminalThemes,
  cssThemeProperties,
  type ThemeName,
  type ThemeDefinition,
  type CssThemeProperties,
  type TerminalThemeColors,
} from './themes';
