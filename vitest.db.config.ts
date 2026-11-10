import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// DB suite (RLS / migrations / DB-backed integration). Run via `bash scripts/db-test.sh`, which
// starts a throwaway Postgres and sets DATABASE_URL. All files share one database, so no file
// parallelism.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    name: 'db',
    environment: 'node',
    include: ['tests/db/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
