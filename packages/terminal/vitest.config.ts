import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GHOSTTY_VERSION__: JSON.stringify('test') },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
  bench: { include: ['bench/**/*.bench.ts'] },
});
