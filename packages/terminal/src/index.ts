export { useTerminal } from './useTerminal';
export {
  spawnTerminal,
  connectPtyOutput,
  connectPtyOutputFresh,
  writeToPty,
  resizePty,
  closePty,
  getPtyCwd,
} from './pty';
export {
  getCached,
  setCached,
  disposeCached,
  getAllCached,
  type CachedEntry,
} from './terminal-cache';
export { ensureGhosttyInit } from './ghostty-init';
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
