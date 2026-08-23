import { describe, expect, it } from 'vitest';
import { buildSeedData } from '../../packages/db/src/seed/buildSeedData.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';
import { createDb } from '../../packages/db/src/client.ts';

/**
 * Database integration tests (Phase 1/2) — require a live PostgreSQL.
 * Skipped automatically when DATABASE_URL is not set (e.g. Docker Desktop
 * not running yet). Start the DB with `pnpm db:up`, apply migrations with
 * `pnpm db:push`, then run: DATABASE_URL=... pnpm test
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('database integration', () => {
  it('reseeds cleanly and exposes relational queries', async () => {
    const counts = await seedDatabase();
    expect(counts.cases).toBeGreaterThanOrEqual(15);
    expect(counts.activities).toBeGreaterThanOrEqual(100);

    const db = createDb();
    try {
      const rows = await db.query.cases.findMany({ limit: 5 });
      expect(rows.length).toBeGreaterThan(0);

      const withProperty = await db.query.cases.findMany({
        with: { property: true },
        limit: 5,
      });
      for (const row of withProperty) {
        expect(row.property).not.toBeNull();
        expect(row.property?.agencyId).toBe(row.agencyId);
      }
    } finally {
      await db.$client.end();
    }
  });

  it('keeps audit log append-only via repository surface', async () => {
    const { createRepositories } = await import('../../packages/db/src/repositories.ts');
    const db = createDb();
    try {
      const repos = createRepositories(db);
      // The append-only contract is enforced by API shape: no update/delete.
      expect(repos.auditLogs.update).toBeUndefined();
      expect(repos.auditLogs.delete).toBeUndefined();
      const logs = await repos.auditLogs.listByEntity('Case', 'cas_001');
      expect(Array.isArray(logs)).toBe(true);
    } finally {
      await db.$client.end();
    }
  });

  it('seed fixture satisfies bilingual invariants in the database', async () => {
    const data = buildSeedData();
    expect(data.communications.some((m) => m.translatedContentZh && m.direction === 'INBOUND')).toBe(true);
  });
});
