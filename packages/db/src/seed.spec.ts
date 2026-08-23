import { describe, expect, it } from 'vitest';
import { buildSeedData, TARGET_COUNTS, type SeedDataset } from './seed/buildSeedData.ts';

/** Phase 1 Gate — seed data integrity, determinism and Spec §15 minimums. */

const FIXED_NOW = new Date('2026-08-23T09:00:00.000Z');
let cached: SeedDataset | null = null;

function dataset(): SeedDataset {
  cached ??= buildSeedData(FIXED_NOW);
  return cached;
}

describe('seed meets Spec §15 dataset minimums', () => {
  const d = () => dataset();

  it('has enough properties and contacts per role', () => {
    expect(d().properties.length).toBeGreaterThanOrEqual(TARGET_COUNTS.properties);
    const owners = d().contacts.filter((c) => c.id.startsWith('con_')).length;
    expect(owners).toBeGreaterThanOrEqual(
      TARGET_COUNTS.owners + TARGET_COUNTS.tenants + TARGET_COUNTS.buyers + TARGET_COUNTS.vendors,
    );
  });

  it('covers communications / tasks / cases / approvals / activities', () => {
    expect(d().communications.length).toBeGreaterThanOrEqual(TARGET_COUNTS.communications);
    expect(d().tasks.length).toBeGreaterThanOrEqual(TARGET_COUNTS.tasks);
    expect(d().cases.length).toBeGreaterThanOrEqual(TARGET_COUNTS.cases);
    expect(d().approvals.length).toBeGreaterThanOrEqual(TARGET_COUNTS.approvals);
    expect(d().activities.length).toBeGreaterThanOrEqual(TARGET_COUNTS.activities);
  });

  it('includes both PM and Sales business domains', () => {
    const domains = new Set(d().cases.map((c) => c.businessDomain));
    expect(domains.has('PROPERTY_MANAGEMENT')).toBe(true);
    expect(domains.has('SALES')).toBe(true);
  });
});

describe('seed referential integrity', () => {
  const d = () => dataset();
  const has = (ids: Set<string>, id: string | null | undefined) =>
    id === null || id === undefined || ids.has(id);

  it('every case references an existing property', () => {
    const propertyIds = new Set(d().properties.map((p) => p.id));
    for (const c of d().cases) expect(has(propertyIds, c.propertyId)).toBe(true);
  });

  it('every communication references existing case/sender', () => {
    const caseIds = new Set(d().cases.map((c) => c.id));
    const contactIds = new Set(d().contacts.map((c) => c.id));
    for (const m of d().communications) {
      expect(has(caseIds, m.caseId)).toBe(true);
      expect(has(contactIds, m.senderContactId)).toBe(true);
    }
  });

  it('every approval points at an existing AI action', () => {
    const actionIds = new Set(d().aiActions.map((a) => a.id));
    for (const a of d().approvals) {
      expect(actionIds.has(a.actionId)).toBe(true);
      expect(a.status).toBe('PENDING');
    }
  });

  it('property-contact links only reference known rows', () => {
    const propertyIds = new Set(d().properties.map((p) => p.id));
    const contactIds = new Set(d().contacts.map((c) => c.id));
    for (const pc of d().propertyContacts) {
      expect(propertyIds.has(pc.propertyId)).toBe(true);
      expect(contactIds.has(pc.contactId)).toBe(true);
    }
  });
});

describe('bilingual by design in fixtures', () => {
  it('inbound emails carry non-empty Chinese translation alongside English original', () => {
    const inbound = dataset().communications.filter((m) => m.direction === 'INBOUND');
    expect(inbound.length).toBeGreaterThan(0);
    for (const m of inbound) {
      expect(m.originalLanguage).toBe('en');
      expect(m.originalContent).toBeTruthy();
      expect(m.translatedContentZh).toBeTruthy();
    }
  });

  it('outbound emails are marked SENT with sentAt', () => {
    const outbound = dataset().communications.filter((m) => m.direction === 'OUTBOUND');
    for (const m of outbound) {
      expect(m.status).toBe('SENT');
      expect(m.sentAt).not.toBeNull();
    }
  });
});

describe('determinism (Phase 2 gate prerequisite)', () => {
  it('two builds with same seed produce identical datasets', () => {
    const a = buildSeedData(FIXED_NOW);
    const b = buildSeedData(FIXED_NOW);
    expect(JSON.stringify(a.contacts)).toBe(JSON.stringify(b.contacts));
    expect(JSON.stringify(a.cases)).toBe(JSON.stringify(b.cases));
    expect(JSON.stringify(a.activities)).toBe(JSON.stringify(b.activities));
  });
});
