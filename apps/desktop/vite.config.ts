import { execSync } from 'node:child_process';

import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import ghosttyPkg from 'ghostty-web/package.json' with { type: 'json' };
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// Expose current git branch to the frontend as import.meta.env.VITE_GIT_BRANCH (dev only)
if (!process.env.VITE_GIT_BRANCH) {
  try {
    process.env.VITE_GIT_BRANCH = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
    }).trim();
  } catch {
    process.env.VITE_GIT_BRANCH = 'unknown';
  }
}

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '__tests__',
    }),
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
  server: {
    port: parseInt(process.env.VITE_PORT ?? '5173'),
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  define: {
    // Replaced at build time — used by ghostty-init.ts for the IDB cache key.
    __GHOSTTY_VERSION__: JSON.stringify(ghosttyPkg.version),
  },
});
