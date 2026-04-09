/** Opens a native directory picker. Returns the selected path or null if cancelled/unavailable. */
export async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title, defaultPath });
    return typeof selected === 'string' ? selected : null;
  } catch {
    return null;
  }
}
