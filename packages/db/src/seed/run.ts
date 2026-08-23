import { buildSeedData } from './buildSeedData.ts';
import { createDb, getPool } from '../client.ts';
import {
  activities,
  agencies,
  aiActions,
  aiFeedbacks,
  approvals,
  auditLogs,
  cases,
  communications,
  contacts,
  properties,
  propertyContacts,
  tasks,
  users,
} from '../schema/index.ts';

/**
 * Reset + reseed the database (Phase 2 gate: reproducible environment).
 * Deletes run in reverse FK order, inserts in FK order — idempotent reset.
 */
export async function seedDatabase(databaseUrl?: string) {
  const db = createDb(databaseUrl);
  const data = buildSeedData();

  await db.delete(activities);
  await db.delete(auditLogs);
  await db.delete(approvals);
  await db.delete(aiFeedbacks);
  await db.delete(aiActions);
  await db.delete(tasks);
  await db.delete(communications);
  await db.delete(cases);
  await db.delete(propertyContacts);
  await db.delete(properties);
  await db.delete(contacts);
  await db.delete(users);
  await db.delete(agencies);

  await db.insert(agencies).values(data.agencies);
  await db.insert(users).values(data.users);
  await db.insert(contacts).values(data.contacts);
  await db.insert(properties).values(data.properties);
  await db.insert(propertyContacts).values(data.propertyContacts);
  await db.insert(cases).values(data.cases);
  await db.insert(communications).values(data.communications);
  await db.insert(tasks).values(data.tasks);
  await db.insert(aiActions).values(data.aiActions);
  await db.insert(approvals).values(data.approvals);
  await db.insert(activities).values(data.activities);
  await db.insert(auditLogs).values(data.auditLogs);

  const counts = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length]),
  ) as Record<string, number>;

  await getPool(db).end();
  return counts;
}

const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  seedDatabase()
    .then((counts) => {
      process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
    })
    .catch((err: unknown) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
