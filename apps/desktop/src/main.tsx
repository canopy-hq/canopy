import { StrictMode } from 'react';

import { initDb, runMigrations, hydrateCollections } from '@canopy/db';
import { ensureGhosttyInit } from '@canopy/terminal';
import { RouterProvider } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { createRoot } from 'react-dom/client';

import { router } from './router';
import './index.css';

// Fire WASM loading and font preloading immediately, before DB init runs.
// Both are fire-and-forget: DB init proceeds in parallel; terminals await the
// resolved promise lazily when the first pane opens.
void ensureGhosttyInit();
void document.fonts?.load('13px "Geist Mono", Menlo, Monaco, "Courier New", monospace');
void document.fonts?.load('bold 13px "Geist Mono", Menlo, Monaco, "Courier New", monospace');

async function boot() {
  const dbPath = await invoke<string>('get_db_path');

  try {
    await initDb(`sqlite:${dbPath}`);
    await runMigrations();
    sessionStorage.removeItem('boot_db_retry');
  } catch (err) {
    // Guard against infinite reload if delete_db itself can't fix the issue.
    if (sessionStorage.getItem('boot_db_retry')) {
      console.error('[boot] DB recovery failed twice — giving up:', err);
      return;
    }
    console.error('[boot] DB init/migration failed, deleting DB and reloading:', err);
    sessionStorage.setItem('boot_db_retry', '1');
    await invoke('delete_db');
    location.reload();
    return;
  }

  await hydrateCollections();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  // Background update check — only in production builds.
  // TODO: surface this in the app UI instead of logging.
  if (import.meta.env.PROD) {
    check()
      .then((update) => {
        if (update) {
          console.log(`[updater] update available: ${update.version}`);
        }
      })
      .catch((err) => console.warn('[updater] check failed:', err));
  }
}

await boot();
