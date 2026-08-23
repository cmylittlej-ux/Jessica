import type { ReosDatabase } from './client.ts';
import type { approvals } from './schema/index.ts';
import { activities, auditLogs, cases } from './schema/index.ts';

/**
 * Business-rule services (Phase 1). Pure transition helpers are exported
 * separately so they are unit-testable without a database; the DB-backed
 * wrappers persist state plus the mandatory Activity + AuditLog entries
 * (Spec §2.5 / §2.6).
 */

// ---------------------------------------------------------------------------
// Pure transition rules
// ---------------------------------------------------------------------------

export type ApprovalStatus = (typeof approvals.$inferSelect)['status'];

const APPROVAL_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * Approval state machine (Spec §27):
 * PENDING → APPROVED / REJECTED / CANCELLED; terminal states never move.
 */
export function nextApprovalStatus(
  current: ApprovalStatus,
  decision: 'APPROVED' | 'REJECTED' | 'CANCELLED',
): ApprovalStatus {
  const allowed = APPROVAL_TRANSITIONS[current];
  if (!allowed.includes(decision)) {
    throw new Error(`Illegal approval transition: ${current} -> ${decision}`);
  }
  return decision;
}

export type WorkflowStatus = (typeof cases.$inferSelect)['status'];

const CASE_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  NEW: ['AI_PROCESSING', 'READY_FOR_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED'],
  AI_PROCESSING: ['READY_FOR_REVIEW', 'IN_PROGRESS', 'COMPLETED'],
  READY_FOR_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'ARCHIVED'],
  IN_PROGRESS: ['WAITING', 'FOLLOW_UP_DUE', 'COMPLETED', 'ARCHIVED'],
  WAITING: ['IN_PROGRESS', 'FOLLOW_UP_DUE', 'COMPLETED', 'ARCHIVED'],
  FOLLOW_UP_DUE: ['IN_PROGRESS', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Workflow status machine (Spec §6 Dimension 4). */
export function nextCaseStatus(
  current: WorkflowStatus,
  target: WorkflowStatus,
): WorkflowStatus {
  if (!CASE_TRANSITIONS[current].includes(target)) {
    throw new Error(`Illegal case status transition: ${current} -> ${target}`);
  }
  return target;
}

// ---------------------------------------------------------------------------
// DB-backed operations (audit-first)
// ---------------------------------------------------------------------------

export interface OpenCaseInput {
  id: string;
  agencyId: string;
  propertyId?: string | null;
  title: string;
  businessDomain: (typeof cases.$inferInsert)['businessDomain'];
  caseType: (typeof cases.$inferInsert)['caseType'];
  priority?: (typeof cases.$inferInsert)['priority'];
  assignedUserId?: string | null;
  actorType?: 'USER' | 'AI' | 'SYSTEM';
  actorId?: string;
}

/**
 * Open a case and write the mandatory Activity + AuditLog trail.
 * Every mutation in REOS must leave this trail (Spec §2.6).
 */
export async function openCase(db: ReosDatabase, input: OpenCaseInput) {
  const now = new Date();
  const [created] = await db
    .insert(cases)
    .values({
      id: input.id,
      agencyId: input.agencyId,
      propertyId: input.propertyId ?? null,
      title: input.title,
      businessDomain: input.businessDomain,
      caseType: input.caseType,
      priority: input.priority ?? 'NORMAL',
      status: 'NEW',
      assignedUserId: input.assignedUserId ?? null,
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    })
      .returning();

  if (!created) throw new Error('openCase: insert returned no row');

  await db.insert(activities).values({
    id: `actv_${crypto.randomUUID()}`,
    agencyId: input.agencyId,
    propertyId: input.propertyId ?? null,
    caseId: created.id,
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId,
    activityType: 'CASE_OPENED',
    title: `Case opened: ${input.title}`,
    occurredAt: now,
  });

  await db.insert(auditLogs).values({
    id: `aud_${crypto.randomUUID()}`,
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId,
    action: 'case.create',
    entityType: 'Case',
    entityId: created.id,
    afterData: created,
    metadata: { source: 'openCase service' },
    createdAt: now,
  });

  return created;
}
