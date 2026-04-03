import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { initDb, runMigrations, hydrateCollections } from '@superagent/db';
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
}

await boot();
