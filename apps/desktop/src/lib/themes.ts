// Theme definitions for Superagent
// 8 dark themes, each with CSS custom properties + xterm.js color scheme

export type ThemeName =
  | 'carbon'
  | 'graphite'
  | 'obsidian'
  | 'slate'
  | 'midnight'
  | 'void'
  | 'smoke'
  | 'ash';

export interface CssThemeProperties {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  border: string;
  borderFocus: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  tabActiveBg: string;
  tabInactiveBg: string;
  splitterIdle: string;
  splitterHover: string;
  branchIcon: string;
  worktreeIcon: string;
  gitAhead: string;
  gitBehind: string;
  destructive: string;
}

export interface XtermThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeDefinition {
  css: CssThemeProperties;
  xterm: XtermThemeColors;
}

export const themes: Record<ThemeName, ThemeDefinition> = {
  // Obsidian -- deep blue-black (DEFAULT, matches current hardcoded values)
  obsidian: {
    css: {
      bgPrimary: '#0a0a14',
      bgSecondary: '#12121f',
      bgTertiary: '#1a1a2e',
      border: '#2a2a3e',
      borderFocus: '#3b82f6',
      textPrimary: '#e0e0e0',
      textMuted: '#9ca3af',
      accent: '#3b82f6',
      tabActiveBg: '#1a1a2e',
      tabInactiveBg: '#0a0a14',
      splitterIdle: '#2a2a3e',
      splitterHover: '#3a3a5e',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#0a0a14',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      selectionBackground: '#3b82f680',
      black: '#1a1a2e',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e0e0e0',
      brightBlack: '#6b7280',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Carbon -- warm neutral
  carbon: {
    css: {
      bgPrimary: '#0f0e0c',
      bgSecondary: '#1a1816',
      bgTertiary: '#252220',
      border: '#3a3530',
      borderFocus: '#d97706',
      textPrimary: '#e8e4de',
      textMuted: '#a39e96',
      accent: '#d97706',
      tabActiveBg: '#252220',
      tabInactiveBg: '#0f0e0c',
      splitterIdle: '#3a3530',
      splitterHover: '#4a4540',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#0f0e0c',
      foreground: '#e8e4de',
      cursor: '#e8e4de',
      selectionBackground: '#d9770680',
      black: '#252220',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e8e4de',
      brightBlack: '#6b6560',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Graphite -- cool gray
  graphite: {
    css: {
      bgPrimary: '#0e0e10',
      bgSecondary: '#18181c',
      bgTertiary: '#222228',
      border: '#333340',
      borderFocus: '#8b5cf6',
      textPrimary: '#e4e4e8',
      textMuted: '#9ca0a8',
      accent: '#8b5cf6',
      tabActiveBg: '#222228',
      tabInactiveBg: '#0e0e10',
      splitterIdle: '#333340',
      splitterHover: '#444450',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#0e0e10',
      foreground: '#e4e4e8',
      cursor: '#e4e4e8',
      selectionBackground: '#8b5cf680',
      black: '#222228',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e4e4e8',
      brightBlack: '#6b6b78',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Slate -- blue-gray
  slate: {
    css: {
      bgPrimary: '#0c0e14',
      bgSecondary: '#141822',
      bgTertiary: '#1e2230',
      border: '#2e3448',
      borderFocus: '#38bdf8',
      textPrimary: '#e0e4ea',
      textMuted: '#94a0b4',
      accent: '#38bdf8',
      tabActiveBg: '#1e2230',
      tabInactiveBg: '#0c0e14',
      splitterIdle: '#2e3448',
      splitterHover: '#3e4458',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#0c0e14',
      foreground: '#e0e4ea',
      cursor: '#e0e4ea',
      selectionBackground: '#38bdf880',
      black: '#1e2230',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e0e4ea',
      brightBlack: '#6478a0',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Midnight -- deep navy
  midnight: {
    css: {
      bgPrimary: '#060a18',
      bgSecondary: '#0c1228',
      bgTertiary: '#141c38',
      border: '#1e2a4e',
      borderFocus: '#6366f1',
      textPrimary: '#dce0f0',
      textMuted: '#8890b0',
      accent: '#6366f1',
      tabActiveBg: '#141c38',
      tabInactiveBg: '#060a18',
      splitterIdle: '#1e2a4e',
      splitterHover: '#2e3a5e',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#060a18',
      foreground: '#dce0f0',
      cursor: '#dce0f0',
      selectionBackground: '#6366f180',
      black: '#141c38',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#dce0f0',
      brightBlack: '#5060a0',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Void -- near-pure black
  void: {
    css: {
      bgPrimary: '#050508',
      bgSecondary: '#0c0c10',
      bgTertiary: '#141418',
      border: '#222228',
      borderFocus: '#a855f7',
      textPrimary: '#d8d8dc',
      textMuted: '#808088',
      accent: '#a855f7',
      tabActiveBg: '#141418',
      tabInactiveBg: '#050508',
      splitterIdle: '#222228',
      splitterHover: '#333338',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#050508',
      foreground: '#d8d8dc',
      cursor: '#d8d8dc',
      selectionBackground: '#a855f780',
      black: '#141418',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d8d8dc',
      brightBlack: '#555560',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Smoke -- warm brown-gray
  smoke: {
    css: {
      bgPrimary: '#100e0c',
      bgSecondary: '#1c1916',
      bgTertiary: '#282420',
      border: '#3c3632',
      borderFocus: '#f59e0b',
      textPrimary: '#e8e2da',
      textMuted: '#a09890',
      accent: '#f59e0b',
      tabActiveBg: '#282420',
      tabInactiveBg: '#100e0c',
      splitterIdle: '#3c3632',
      splitterHover: '#4c4642',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#100e0c',
      foreground: '#e8e2da',
      cursor: '#e8e2da',
      selectionBackground: '#f59e0b80',
      black: '#282420',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e8e2da',
      brightBlack: '#706860',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },

  // Ash -- desaturated cool-green
  ash: {
    css: {
      bgPrimary: '#0a0e0c',
      bgSecondary: '#141a18',
      bgTertiary: '#1e2624',
      border: '#2e3836',
      borderFocus: '#10b981',
      textPrimary: '#dce4e0',
      textMuted: '#8ca098',
      accent: '#10b981',
      tabActiveBg: '#1e2624',
      tabInactiveBg: '#0a0e0c',
      splitterIdle: '#2e3836',
      splitterHover: '#3e4846',
      branchIcon: '#60a5fa',
      worktreeIcon: '#c084fc',
      gitAhead: '#4ade80',
      gitBehind: '#f87171',
      destructive: '#ef4444',
    },
    xterm: {
      background: '#0a0e0c',
      foreground: '#dce4e0',
      cursor: '#dce4e0',
      selectionBackground: '#10b98180',
      black: '#1e2624',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#dce4e0',
      brightBlack: '#607870',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
  },
};

export const themeNames: ThemeName[] = Object.keys(themes) as ThemeName[];

export const xtermThemes: Record<ThemeName, XtermThemeColors> = Object.fromEntries(
  themeNames.map((name) => [name, themes[name].xterm]),
) as Record<ThemeName, XtermThemeColors>;

export const cssThemeProperties: Record<ThemeName, CssThemeProperties> = Object.fromEntries(
  themeNames.map((name) => [name, themes[name].css]),
) as Record<ThemeName, CssThemeProperties>;
