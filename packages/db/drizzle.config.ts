import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. `generate`/`check` run fully offline;
 * `migrate`/`push`/`studio` need the database (pnpm db:up first).
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://reos:reos@localhost:5432/reos',
  },
  strict: true,
  verbose: true,
});
