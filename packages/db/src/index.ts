/**
 * @reos/db — schema, client, repositories and seed (Drizzle + PostgreSQL).
 */
export * from './schema/index.ts';
export { createDb, getPool, type ReosDatabase } from './client.ts';
export { createRepositories, type ReosRepositories } from './repositories.ts';
export {
  nextApprovalStatus,
  nextCaseStatus,
  openCase,
  type OpenCaseInput,
} from './services.ts';
export {
  buildSeedData,
  TARGET_COUNTS,
  type SeedDataset,
} from './seed/buildSeedData.ts';
export { seedDatabase } from './seed/run.ts';
