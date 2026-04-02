import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { initDb, runMigrations, hydrateCollections } from '@superagent/db';
import { routeTree } from './routeTree.gen';
import './index.css';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

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

boot();
