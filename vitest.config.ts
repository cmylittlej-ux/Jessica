import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.spec.ts',
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
    ],
    // DB-dependent integration tests (Phase 1+) require a running database;
    // they are named *.db.spec.ts and only run when DATABASE_URL is set.
    exclude: ['**/node_modules/**', '**/.next/**', 'tests/e2e/**'],
    // Integration tests reset the shared database via seedDatabase(); parallel
    // files would delete each other's rows mid-run (FK violations). Serialize.
    fileParallelism: false,
  },
});
