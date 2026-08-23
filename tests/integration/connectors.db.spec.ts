import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createMockCRMConnector,
  createMockEmailConnector,
  createMockPropertyConnector,
} from '../../packages/connectors/src/index.ts';
import { activities, auditLogs, cases, communications } from '../../packages/db/src/schema/index.ts';
import { createDb, getPool } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';

/**
 * Connector integration tests + the Phase 2 Gate:
 * "能够重置数据库并稳定生成相同测试环境" — resetting must yield a byte-stable
 * environment. Skipped automatically when DATABASE_URL is not set.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

/** Ordered full dump of every core table, straight from PostgreSQL. */
const SNAPSHOT_TABLES = [
  'agencies',
  'users',
  'contacts',
  'properties',
  'property_contacts',
  'cases',
  'communications',
  'tasks',
  'ai_actions',
  'ai_feedbacks',
  'approvals',
  'activities',
  'audit_logs',
] as const;

async function snapshotAllTables(): Promise<string> {
  const pool = getPool(createDb());
  try {
    const sections: string[] = [];
    for (const table of SNAPSHOT_TABLES) {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
      sections.push(`${table}=${JSON.stringify(result.rows)}`);
    }
    return sections.join('\n');
  } finally {
    pool.end();
  }
}

describe.skipIf(!hasDb)('Phase 2 gate — reset determinism', () => {
  it('two consecutive full resets produce identical database contents', async () => {
    await seedDatabase();
    const before = await snapshotAllTables();
    await seedDatabase();
    const after = await snapshotAllTables();
    expect(after).toEqual(before);
  });
});

describe.skipIf(!hasDb)('MockEmailConnector', () => {
  it('send records SENT status, Activity, AuditLog and final content in one transaction', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const [parentCase] = await db.select().from(cases).limit(1);
      expect(parentCase).toBeDefined();
      if (!parentCase) return;

      const connector = createMockEmailConnector(db);
      const result = await connector.send({
        caseId: parentCase.id,
        subject: 'Re: Hot water system repair',
        content: 'FINAL APPROVED REPLY — plumber booked for Tuesday 9am.',
        recipients: { to: ['tenant@example.test'] },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 1 + 4: SENT status + final content saved verbatim.
      const [saved] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, result.value.communicationId))
        .limit(1);
      expect(saved).toBeDefined();
      if (!saved) return;
      expect(saved.status).toBe('SENT');
      expect(saved.sentAt).not.toBeNull();
      expect(saved.originalContent).toBe(
        'FINAL APPROVED REPLY — plumber booked for Tuesday 9am.',
      );
      expect(saved.direction).toBe('OUTBOUND');

      // 2: Activity produced and linked to the case.
      const caseActivities = await db
        .select()
        .from(activities)
        .where(eq(activities.caseId, parentCase.id));
      expect(caseActivities.some((a) => a.activityType === 'EMAIL_SENT')).toBe(true);

      // 3: AuditLog produced (append-only trail).
      const trail = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, saved.id));
      expect(trail.length).toBeGreaterThanOrEqual(1);
      expect(trail[0]?.action).toBe('communication.send');
    } finally {
      await getPool(db).end();
    }
  });

  it('rejects invalid sends without writing anything (no silent fail)', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const connector = createMockEmailConnector(db);

      const empty = await connector.send({ subject: 'x', content: '   ' });
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.error.code).toBe('VALIDATION');

      const orphan = await connector.send({ subject: 'x', content: 'hello' });
      expect(orphan.ok).toBe(false);
      if (!orphan.ok) expect(orphan.error.code).toBe('VALIDATION');

      const missingCase = await connector.send({
        caseId: 'case_does_not_exist',
        subject: 'x',
        content: 'hello',
      });
      expect(missingCase.ok).toBe(false);
      if (!missingCase.ok) expect(missingCase.error.code).toBe('NOT_FOUND');
    } finally {
      await getPool(db).end();
    }
  });

  it('listInbound returns seeded bilingual inbox entries', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const connector = createMockEmailConnector(db);
      const result = await connector.listInbound();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThanOrEqual(30);
      const withTranslation = result.value.filter((m) => m.translatedContentZh !== null);
      expect(withTranslation.length).toBeGreaterThan(0);
    } finally {
      await getPool(db).end();
    }
  });
});

describe.skipIf(!hasDb)('MockPropertyConnector / MockCRMConnector', () => {
  it('lists portfolio with filters and resolves by id', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const properties = createMockPropertyConnector(db);

      const all = await properties.list();
      expect(all.ok && all.value.length >= 20).toBe(true);

      const leased = await properties.list({ status: 'LEASED' });
      expect(leased.ok && leased.value.every((p) => p.status === 'LEASED')).toBe(true);

      const suburb = await properties.list({ suburb: '%Carlton%' });
      expect(suburb.ok && suburb.value.every((p) => p.suburb === 'Carlton')).toBe(true);

      if (!all.ok || all.value.length === 0) return;
      const one = await properties.getById(all.value[0]?.id ?? '');
      expect(one.ok && one.value?.id).toBe(all.value[0]?.id);

      const missing = await properties.getById('prop_nope');
      expect(missing.ok && missing.value).toBeNull();
    } finally {
      await getPool(db).end();
    }
  });

  it('derives role views from property_contacts without duplicating people', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const crm = createMockCRMConnector(db);

      const owners = await crm.listByRole('OWNER');
      expect(owners.ok && owners.value.length).toBeGreaterThanOrEqual(30);

      const buyers = await crm.listByRole('BUYER');
      expect(buyers.ok && buyers.value.length).toBeGreaterThanOrEqual(40);

      const search = await crm.searchByName('a');
      expect(search.ok && search.value.length).toBeGreaterThan(0);

      if (!owners.ok || owners.value.length === 0) return;
      const first = owners.value[0];
      expect(first).toBeDefined();
      if (!first) return;
      const byId = await crm.getById(first.id);
      expect(byId.ok && byId.value?.displayName).toBe(first.displayName);
    } finally {
      await getPool(db).end();
    }
  });
});
