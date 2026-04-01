import { describe, it, expect } from 'vitest';
import { themes, themeNames, xtermThemes, cssThemeProperties, type ThemeName } from '../themes';

const EXPECTED_THEMES: ThemeName[] = [
  'carbon', 'graphite', 'obsidian', 'slate', 'midnight', 'void', 'smoke', 'ash',
];

const CSS_KEYS = [
  'bgPrimary', 'bgSecondary', 'bgTertiary', 'border', 'borderFocus',
  'textPrimary', 'textMuted', 'accent', 'tabActiveBg', 'tabInactiveBg',
  'splitterIdle', 'splitterHover',
] as const;

const XTERM_KEYS = [
  'background', 'foreground', 'cursor', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

describe('themes', () => {
  it('has exactly 8 theme entries', () => {
    expect(Object.keys(themes)).toHaveLength(8);
  });

  it('contains all expected theme names', () => {
    expect(Object.keys(themes).sort()).toEqual([...EXPECTED_THEMES].sort());
  });

  it('each theme has all 12 CSS property keys', () => {
    for (const name of EXPECTED_THEMES) {
      const css = themes[name].css;
      for (const key of CSS_KEYS) {
        expect(css).toHaveProperty(key);
        expect(typeof css[key]).toBe('string');
      }
    }
  });

  it('each theme has an xterm theme object with 20 color keys', () => {
    for (const name of EXPECTED_THEMES) {
      const xterm = themes[name].xterm;
      for (const key of XTERM_KEYS) {
        expect(xterm).toHaveProperty(key);
        expect(typeof xterm[key]).toBe('string');
      }
    }
  });

  it('Obsidian bgPrimary matches current hardcoded value #0a0a14', () => {
    expect(themes.obsidian.css.bgPrimary).toBe('#0a0a14');
  });

  it('Obsidian xterm background matches #0a0a14', () => {
    expect(themes.obsidian.xterm.background).toBe('#0a0a14');
  });

  it('Obsidian xterm foreground matches #e0e0e0', () => {
    expect(themes.obsidian.xterm.foreground).toBe('#e0e0e0');
  });
});

describe('themeNames', () => {
  it('has length 8', () => {
    expect(themeNames).toHaveLength(8);
  });

  it('contains all expected names', () => {
    expect([...themeNames].sort()).toEqual([...EXPECTED_THEMES].sort());
  });
});

describe('xtermThemes', () => {
  it('has entries for all 8 themes', () => {
    expect(Object.keys(xtermThemes)).toHaveLength(8);
  });

  it('values match themes[name].xterm', () => {
    for (const name of EXPECTED_THEMES) {
      expect(xtermThemes[name]).toEqual(themes[name].xterm);
    }
  });
});

describe('cssThemeProperties', () => {
  it('has entries for all 8 themes', () => {
    expect(Object.keys(cssThemeProperties)).toHaveLength(8);
  });

  it('values match themes[name].css', () => {
    for (const name of EXPECTED_THEMES) {
      expect(cssThemeProperties[name]).toEqual(themes[name].css);
    }
  });
});
