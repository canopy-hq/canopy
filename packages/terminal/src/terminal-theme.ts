import { getAllCached } from './terminal-cache';
import { terminalThemes, type ThemeName } from './themes';

export function applyThemeToAll(name: ThemeName): void {
  const theme = terminalThemes[name];
  for (const { term } of getAllCached().values()) {
    term.options.theme = theme;
    if (term.element) term.element.style.background = theme.background;
  }
}
