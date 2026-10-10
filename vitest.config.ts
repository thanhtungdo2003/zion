import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    pool: 'threads',
  },
});
