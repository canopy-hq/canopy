import { bench, describe } from 'vitest';

import { cssThemeProperties, terminalThemes, themeNames, themes } from '../src/themes';

describe('themes — lookup baseline', () => {
  bench('cssThemeProperties["obsidian"] property access', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = cssThemeProperties['obsidian'];
  });

  bench('terminalThemes["obsidian"] property access', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = terminalThemes['obsidian'];
  });

  bench('themes["obsidian"].css.bgPrimary nested access', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = themes['obsidian'].css.bgPrimary;
  });

  bench('iterate all themeNames (8 names)', () => {
    for (const name of themeNames) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = cssThemeProperties[name];
    }
  });
});
