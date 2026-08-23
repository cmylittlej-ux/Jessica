import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type ReosDatabase = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client bound to the REOS schema.
 * Local default matches docker-compose.yml (user/pass/db = reos/reos/reos).
 */
export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? 'postgresql://reos:reos@localhost:5432/reos';
  const pool = new pg.Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

/** Extract the underlying pool for graceful shutdown. */
export function getPool(db: ReosDatabase): pg.Pool {
  return (db as unknown as { $client: pg.Pool }).$client;
}
