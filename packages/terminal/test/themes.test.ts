import { describe, expect, it } from 'vitest';

import {
  cssThemeProperties,
  terminalThemes,
  themeNames,
  themes,
  type CssThemeProperties,
  type TerminalThemeColors,
  type ThemeName,
} from '../src/themes';

const CSS_FIELDS: (keyof CssThemeProperties)[] = [
  'bgPrimary',
  'bgSecondary',
  'bgTertiary',
  'border',
  'borderFocus',
  'textPrimary',
  'textMuted',
  'accent',
  'tabActiveBg',
  'tabInactiveBg',
  'splitterIdle',
  'splitterHover',
  'branchIcon',
  'worktreeIcon',
  'gitAhead',
  'gitBehind',
  'destructive',
];

const TERMINAL_FIELDS: (keyof TerminalThemeColors)[] = [
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

const HEX_RE = /^#[0-9a-f]{6,8}$/i;

describe('themes', () => {
  it('themeNames length matches Object.keys(themes)', () => {
    expect(themeNames).toHaveLength(Object.keys(themes).length);
  });

  it('themeNames contains all 8 expected theme names', () => {
    const expected: ThemeName[] = [
      'carbon',
      'graphite',
      'obsidian',
      'slate',
      'midnight',
      'void',
      'smoke',
      'ash',
    ];
    expect(themeNames.sort()).toEqual(expected.sort());
  });

  it.each(themeNames)('theme "%s" exists in themes, terminalThemes, and cssThemeProperties', (name) => {
    expect(themes[name]).toBeDefined();
    expect(terminalThemes[name]).toBeDefined();
    expect(cssThemeProperties[name]).toBeDefined();
  });

  it.each(themeNames)('theme "%s" has all CssThemeProperties fields as non-empty strings', (name) => {
    const css = cssThemeProperties[name];
    for (const field of CSS_FIELDS) {
      expect(css[field], `${name}.css.${field}`).toBeTruthy();
      expect(typeof css[field], `${name}.css.${field}`).toBe('string');
    }
  });

  it.each(themeNames)('theme "%s" has all TerminalThemeColors fields as valid hex strings', (name) => {
    const terminal = terminalThemes[name];
    for (const field of TERMINAL_FIELDS) {
      const value = terminal[field];
      expect(value, `${name}.terminal.${field}`).toBeTruthy();
      expect(HEX_RE.test(value), `${name}.terminal.${field} = "${value}" is not a valid hex color`)
        .toBe(true);
    }
  });

  it('terminalThemes is a projection of themes[name].terminal', () => {
    for (const name of themeNames) {
      expect(terminalThemes[name]).toBe(themes[name].terminal);
    }
  });

  it('cssThemeProperties is a projection of themes[name].css', () => {
    for (const name of themeNames) {
      expect(cssThemeProperties[name]).toBe(themes[name].css);
    }
  });
});
