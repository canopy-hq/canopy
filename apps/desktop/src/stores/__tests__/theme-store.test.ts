import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from '../theme-store';

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
    // initTheme catches the Tauri import error internally and falls back to obsidian
    await useThemeStore.getState().initTheme();
    expect(useThemeStore.getState().currentTheme).toBe('obsidian');
    expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian');
  });
});
