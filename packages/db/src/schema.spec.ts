import { describe, expect, it } from 'vitest';
import { getTableColumns, type Column } from 'drizzle-orm';
import {
  agencies,
  aiActions,
  approvals,
  caseTypeEnum,
  cases,
  communicationStatusEnum,
  communications,
  priorityEnum,
  propertyContacts,
  users,
  workflowStatusEnum,
} from './schema/index.ts';
import * as schema from './schema/index.ts';

/** Phase 1 Gate — schema shape tests validate the Spec §5 contract. */

function cols(table: Parameters<typeof getTableColumns>[0]): Record<string, Column> {
  return getTableColumns(table) as Record<string, Column>;
}

describe('core tables exist with spec columns', () => {
  it('agencies has timezone default Melbourne fields', () => {
    const c = cols(agencies);
    expect(c.id?.notNull).toBe(true);
    expect(c.timezone?.notNull).toBe(true);
    expect(c.defaultLanguage?.notNull).toBe(true);
  });

  it('users carries role and aiAutonomyLevel', () => {
    const c = cols(users);
    expect(c.role?.notNull).toBe(true);
    expect(c.aiAutonomyLevel?.notNull).toBe(true);
    expect(c.workingLanguage?.notNull).toBe(true);
  });

  it('communications keeps original content immutable-by-contract', () => {
    const c = cols(communications);
    // Original content is mandatory; translations are optional sidecars
    // that never overwrite the original (Spec §2.7).
    expect(c.originalContent?.notNull).toBe(true);
    expect(c.originalLanguage?.notNull).toBe(true);
    expect(c.translatedContentZh?.notNull).toBe(false);
    expect(c.translatedContentEn?.notNull).toBe(false);
  });

  it('cases exposes the four classification dimensions', () => {
    const c = cols(cases);
    expect(c.businessDomain?.notNull).toBe(true);
    expect(c.caseType?.notNull).toBe(true);
    expect(c.priority?.notNull).toBe(true);
    expect(c.status?.notNull).toBe(true);
  });

  it('audit log is append-only shaped (no updated_at)', () => {
    const c = cols(schema.auditLogs);
    expect(c.updatedAt).toBeUndefined();
    expect(c.beforeData).toBeDefined();
    expect(c.afterData).toBeDefined();
  });
});

describe('spec enumerations', () => {
  it('caseType covers all three business domains', () => {
    expect(caseTypeEnum.enumValues).toContain('MAINTENANCE');
    expect(caseTypeEnum.enumValues).toContain('OFFER');
    expect(caseTypeEnum.enumValues).toContain('SPAM');
  });

  it('priority matches Spec §7', () => {
    expect(priorityEnum.enumValues).toEqual(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
  });

  it('workflowStatus matches Spec §6 dimension 4', () => {
    expect(workflowStatusEnum.enumValues).toContain('AI_PROCESSING');
    expect(workflowStatusEnum.enumValues).toContain('READY_FOR_REVIEW');
  });

  it('communication status supports the approval→send flow', () => {
    expect(communicationStatusEnum.enumValues).toEqual([
      'RECEIVED',
      'PENDING_SEND',
      'SENT',
      'FAILED',
    ]);
  });
});

describe('foreign key graph', () => {
  it('wires property_contacts to both properties and contacts', () => {
    const pc = cols(propertyContacts);
    expect(pc.propertyId?.notNull).toBe(true);
    expect(pc.contactId?.notNull).toBe(true);
    expect(pc.validFrom).toBeDefined();
    expect(pc.validTo).toBeDefined();
  });

  it('approvals reference ai actions (approval chain anchor)', () => {
    const a = cols(approvals);
    expect(a.actionId?.notNull).toBe(true);
    expect(a.status?.notNull).toBe(true);
  });

  it('ai actions record provider/model/payload for auditability', () => {
    const a = cols(aiActions);
    expect(a.provider?.notNull).toBe(true);
    expect(a.model?.notNull).toBe(true);
    expect(a.proposedPayload?.notNull).toBe(true);
    expect(a.confidence?.notNull).toBe(false);
  });
});
