import { StrictMode } from 'react';

import { initDb, runMigrations, hydrateCollections } from '@superagent/db';
import { RouterProvider } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { createRoot } from 'react-dom/client';

import { router } from './router';
import './index.css';

async function boot() {
  const dbPath = await invoke<string>('get_db_path');
  await initDb(`sqlite:${dbPath}`);
  await runMigrations();
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
