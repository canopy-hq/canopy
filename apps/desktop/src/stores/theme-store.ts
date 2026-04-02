import { create } from 'zustand';
import { type ThemeName, themeNames, terminalThemes } from '../lib/themes';
import { getAllCached } from '../lib/terminal-cache';

interface ThemeState {
  currentTheme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  initTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  currentTheme: 'obsidian',

  setTheme: (theme: ThemeName) => {
    set({ currentTheme: theme });

    // Apply to DOM
    document.documentElement.setAttribute('data-theme', theme);

    // Apply to all cached terminals
    const termColors = terminalThemes[theme];
    for (const [, entry] of getAllCached()) {
      entry.term.options.theme = termColors;
      // Sync container background for smooth resize fill
      if (entry.term.element) {
        entry.term.element.style.background = termColors.background;
      }
    }

    // Persist via tauri-plugin-store (lazy import, fail-safe)
    (async () => {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load('settings.json');
        await store.set('theme', theme);
        await store.save();
      } catch {
        // Tauri runtime not available (tests, dev outside Tauri) -- silent
      }
    })();
  },

  initTheme: async () => {
    try {
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('settings.json');
      const saved = await store.get<string>('theme');
      if (saved && themeNames.includes(saved as ThemeName)) {
        useThemeStore.getState().setTheme(saved as ThemeName);
      } else {
        useThemeStore.getState().setTheme('obsidian');
      }
    } catch {
      // Tauri not available -- apply default to DOM
      useThemeStore.getState().setTheme('obsidian');
    }
  },
}));
