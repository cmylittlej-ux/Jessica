import { createDb, type ReosDatabase } from '@reos/db';

/**
 * Single shared database client per server process — avoids pool exhaustion
 * across server components and actions. Default URL matches docker-compose.
 */
let cached: ReosDatabase | undefined;

export function getDb(): ReosDatabase {
  return (cached ??= createDb());
}
