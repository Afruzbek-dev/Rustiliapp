import { defineConfig } from 'vitest/config';

// DB suite (RLS / migrations). Run via `bash scripts/db-test.sh`, which starts a throwaway
// Postgres and sets DATABASE_URL. All files share one database, so no file parallelism.
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
