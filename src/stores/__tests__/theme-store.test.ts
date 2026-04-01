import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @tauri-apps/plugin-store before importing theme-store
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockRejectedValue(new Error('No Tauri runtime')),
}));

// Must import after mock setup
const { useThemeStore } = await import('../theme-store');

describe('theme-store', () => {
  beforeEach(() => {
    // Reset to default state
    useThemeStore.setState({ currentTheme: 'obsidian' });
    document.documentElement.removeAttribute('data-theme');
  });

  it('has obsidian as initial theme', () => {
    expect(useThemeStore.getState().currentTheme).toBe('obsidian');
  });

  it('setTheme updates currentTheme', () => {
    useThemeStore.getState().setTheme('void');
    expect(useThemeStore.getState().currentTheme).toBe('void');
  });

  it('setTheme applies data-theme attribute to document', () => {
    useThemeStore.getState().setTheme('carbon');
    expect(document.documentElement.getAttribute('data-theme')).toBe('carbon');
  });

  it('setTheme applies different themes in sequence', () => {
    useThemeStore.getState().setTheme('midnight');
    expect(useThemeStore.getState().currentTheme).toBe('midnight');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');

    useThemeStore.getState().setTheme('ash');
    expect(useThemeStore.getState().currentTheme).toBe('ash');
    expect(document.documentElement.getAttribute('data-theme')).toBe('ash');
  });

  it('initTheme falls back to obsidian when Tauri is unavailable', async () => {
    await useThemeStore.getState().initTheme();
    expect(useThemeStore.getState().currentTheme).toBe('obsidian');
    expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian');
  });
});
