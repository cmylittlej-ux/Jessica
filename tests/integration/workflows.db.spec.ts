import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAIGateway,
  createBuildContext,
  createMockAIProvider,
} from '../../packages/ai/src/index.ts';
import {
  createApprovalWorkflow,
  createInboundWorkflow,
} from '../../packages/workflows/src/index.ts';
import {
  activities,
  aiActions,
  aiFeedbacks,
  approvals,
  auditLogs,
  cases,
  communications,
  tasks,
  users,
} from '../../packages/db/src/schema/index.ts';
import { createDb, getPool } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Simulate an inbound maintenance email arriving via the (future) connector. */
async function insertInboundEmail(
  db: Awaited<ReturnType<typeof createDb>>,
  input: { externalId: string; subject: string; content: string; propertyId: string; senderContactId: string },
): Promise<string> {
  const id = `com_${input.externalId.replace(/[^a-z0-9]/gi, '_')}`;
  await db.insert(communications).values({
    id,
    propertyId: input.propertyId,
    direction: 'INBOUND',
    channel: 'EMAIL',
    senderContactId: input.senderContactId,
    recipientData: { to: ['neil@bayside.example'] },
    subject: input.subject,
    originalContent: input.content,
    originalLanguage: 'en',
    status: 'RECEIVED',
    externalId: input.externalId,
    receivedAt: new Date(),
  });
  return id;
}

async function firstAdminId(db: Awaited<ReturnType<typeof createDb>>): Promise<string> {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'ADMIN')).limit(1);
  if (!admin) throw new Error('no admin user');
  return admin.id;
}

describe.skipIf(!hasDb)('Phase 4 gate — Maintenance workflow (Spec §26/§27)', () => {
  it('runs the full loop: inbound → classify → case+task → approval → execute → SENT', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      // A tenant reports a hot-water burst on their property.
      const { properties, contacts, propertyContacts } = await import('../../packages/db/src/schema/index.ts');
      const [property] = await db.select().from(properties).where(eq(properties.status, 'LEASED')).limit(1);
      expect(property).toBeDefined();
      if (!property) return;
      const [tenantLink] = await db
        .select({ contactId: propertyContacts.contactId })
        .from(propertyContacts)
        .where(and(eq(propertyContacts.propertyId, property.id), eq(propertyContacts.role, 'TENANT')))
        .limit(1);
      expect(tenantLink).toBeDefined();
      if (!tenantLink) return;

      const commId = await insertInboundEmail(db, {
        externalId: 'maint-e2e-001',
        subject: 'URGENT: hot water system leaking',
        content:
          'The hot water system is leaking badly in the laundry. Water everywhere — the heater is broken and needs an urgent repair.',
        propertyId: property.id,
        senderContactId: tenantLink.contactId,
      });

      // --- Inbound workflow ---
      const process = createInboundWorkflow(db, {
        gateway: createAIGateway({ provider: createMockAIProvider(), db }),
        context: createBuildContext(db),
      });
      const outcome = await process(commId);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok || outcome.value.status !== 'PROCESSED') return;

      expect(outcome.value.confidence).toBeGreaterThanOrEqual(0.9);
      expect(outcome.value.taskIds.length).toBeGreaterThanOrEqual(1);
      expect(outcome.value.aiActionId).not.toBeNull();
      expect(outcome.value.approvalId).not.toBeNull();

      // Case created with bilingual summary + MAINTENANCE classification.
      const [caseRow] = await db.select().from(cases).where(eq(cases.id, outcome.value.caseId)).limit(1);
      expect(caseRow?.caseType).toBe('MAINTENANCE');
      expect(caseRow?.businessDomain).toBe('PROPERTY_MANAGEMENT');
      expect(caseRow?.summary).toContain('classified as MAINTENANCE');
      expect(caseRow?.summary).toContain('已分类');

      // Follow-up task exists with AI provenance.
      const [task] = await db.select().from(tasks).where(eq(tasks.id, outcome.value.taskIds[0]!)).limit(1);
      expect(task?.source).toBe('AI');
      expect(task?.status).toBe('OPEN');

      // Timeline + audit entries written.
      const timeline = await db.select().from(activities).where(eq(activities.caseId, caseRow!.id));
      expect(timeline.some((a) => a.activityType === 'INBOUND_PROCESSED')).toBe(true);
      const trail = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'workflow.process_inbound'), eq(auditLogs.entityId, commId)));
      expect(trail.length).toBe(1);

      // --- Deduplication ---
      const secondRun = await process(commId);
      expect(secondRun.ok && secondRun.value.status === 'DUPLICATE').toBe(true);

      // --- Approval chain (Spec §27) ---
      const reviewer = await firstAdminId(db);
      const approvalsApi = createApprovalWorkflow(db);

      const approved = await approvalsApi.approve({
        approvalId: outcome.value.approvalId!,
        reviewerId: reviewer,
        decisionNote: 'Book the plumber.',
      });
      expect(approved.ok).toBe(true);

      const [actionAfterApprove] = await db
        .select()
        .from(aiActions)
        .where(eq(aiActions.id, outcome.value.aiActionId!))
        .limit(1);
      expect(actionAfterApprove?.status).toBe('APPROVED');

      const executed = await approvalsApi.executeApproved({ approvalId: outcome.value.approvalId! });
      expect(executed.ok).toBe(true);
      if (!executed.ok) return;

      // Mock execution produced a SENT communication with final content.
      const [sentComm] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, executed.value.communicationId!))
        .limit(1);
      expect(sentComm?.status).toBe('SENT');
      expect(sentComm?.direction).toBe('OUTBOUND');
      expect(sentComm?.caseId).toBe(caseRow!.id);
      expect(sentComm?.originalContent).toContain('Thank you for your email');

      // AIAction EXECUTED; timeline + audit complete.
      const [actionFinal] = await db
        .select()
        .from(aiActions)
        .where(eq(aiActions.id, actionAfterApprove!.id))
        .limit(1);
      expect(actionFinal?.status).toBe('EXECUTED');
      expect(actionFinal?.executedAt).not.toBeNull();

      const sentTimeline = await db.select().from(activities).where(eq(activities.caseId, caseRow!.id));
      expect(sentTimeline.some((a) => a.activityType === 'EMAIL_SENT')).toBe(true);
      const execTrail = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'approval.executed'));
      expect(execTrail.length).toBeGreaterThanOrEqual(1);
    } finally {
      await getPool(db).end();
    }
  });
});

describe.skipIf(!hasDb)('Approval rejection never executes (Spec §27)', () => {
  it('rejecting leaves the AIAction REJECTED with no outbound email', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { properties, contacts, propertyContacts } = await import('../../packages/db/src/schema/index.ts');
      const [property] = await db.select().from(properties).limit(1);
      if (!property) return;
      const [tenantLink] = await db
        .select({ contactId: propertyContacts.contactId })
        .from(propertyContacts)
        .where(and(eq(propertyContacts.propertyId, property.id), eq(propertyContacts.role, 'TENANT')))
        .limit(1);
      if (!tenantLink) return;

      const commId = await insertInboundEmail(db, {
        externalId: 'reject-e2e-001',
        subject: 'Blocked drain and broken gate',
        content: 'The drain is blocked and the back gate is broken after the storm. Please arrange a repair.',
        propertyId: property.id,
        senderContactId: tenantLink.contactId,
      });

      const process = createInboundWorkflow(db, {
        gateway: createAIGateway({ provider: createMockAIProvider(), db }),
        context: createBuildContext(db),
      });
      const outcome = await process(commId);
      expect(outcome.ok && outcome.value.status === 'PROCESSED').toBe(true);
      if (!outcome.ok || outcome.value.status !== 'PROCESSED' || !outcome.value.approvalId) return;

      const reviewer = await firstAdminId(db);
      const approvalsApi = createApprovalWorkflow(db);
      const rejected = await approvalsApi.reject({
        approvalId: outcome.value.approvalId,
        reviewerId: reviewer,
        decisionNote: 'Wrong tone, will call instead.',
      });
      expect(rejected.ok).toBe(true);

      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, outcome.value.aiActionId!)).limit(1);
      expect(action?.status).toBe('REJECTED');

      // No new SENT communication was generated for this case after reject.
      const sentForCase = (
        await db
          .select()
          .from(communications)
          .where(and(eq(communications.caseId, outcome.value.caseId), eq(communications.direction, 'OUTBOUND')))
      ).filter((c) => c.sentAt !== null && c.createdAt.getTime() > Date.now() - 60_000);
      expect(sentForCase.length).toBe(0);
    } finally {
      await getPool(db).end();
    }
  });
});

describe.skipIf(!hasDb)('Low confidence goes to manual review (Spec §10/§34-C)', () => {
  it('does not create relations or approvals below the threshold', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { properties, contacts, propertyContacts } = await import('../../packages/db/src/schema/index.ts');
      const [property] = await db.select().from(properties).limit(1);
      if (!property) return;
      const [ownerLink] = await db
        .select({ contactId: propertyContacts.contactId })
        .from(propertyContacts)
        .where(and(eq(propertyContacts.propertyId, property.id), eq(propertyContacts.role, 'OWNER')))
        .limit(1);
      if (!ownerLink) return;

      const commId = await insertInboundEmail(db, {
        externalId: 'lowconf-e2e-001',
        subject: 'Quick question about the Smith matter',
        content: 'Just checking in about that thing we discussed.', // no keywords → 0.55
        propertyId: property.id,
        senderContactId: ownerLink.contactId,
      });

      const process = createInboundWorkflow(db, {
        gateway: createAIGateway({ provider: createMockAIProvider({ fixedConfidence: 0.42 }), db }),
        context: createBuildContext(db),
      });
      const outcome = await process(commId);
      expect(outcome.ok && outcome.value.status === 'NEEDS_REVIEW').toBe(true);
      if (!outcome.ok || outcome.value.status !== 'NEEDS_REVIEW') return;

      const [caseRow] = await db.select().from(cases).where(eq(cases.id, outcome.value.caseId)).limit(1);
      expect(caseRow?.status).toBe('READY_FOR_REVIEW');
      expect(caseRow?.businessDomain).toBe('UNKNOWN');

      // No approvals, no tasks, no reply drafts were auto-created.
      const pendingForCase = await db.select().from(approvals).where(eq(approvals.caseId, caseRow!.id));
      expect(pendingForCase.length).toBe(0);
      const tasksForCase = await db.select().from(tasks).where(eq(tasks.caseId, caseRow!.id));
      expect(tasksForCase.length).toBe(0);

      const holdTrail = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'workflow.low_confidence_hold'));
      expect(holdTrail.some((t) => t.entityId === commId)).toBe(true);
    } finally {
      await getPool(db).end();
    }
  });
});

describe.skipIf(!hasDb)('Edit before approval keeps both drafts (Spec §28)', () => {
  it('records AIFeedback=EDITED and executes the human version', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { properties, contacts, propertyContacts } = await import('../../packages/db/src/schema/index.ts');
      const [property] = await db.select().from(properties).where(eq(properties.status, 'LEASED')).limit(1);
      if (!property) return;
      const [tenantLink] = await db
        .select({ contactId: propertyContacts.contactId })
        .from(propertyContacts)
        .where(and(eq(propertyContacts.propertyId, property.id), eq(propertyContacts.role, 'TENANT')))
        .limit(1);
      if (!tenantLink) return;

      const commId = await insertInboundEmail(db, {
        externalId: 'edit-e2e-001',
        subject: 'Dishwasher broken',
        content: 'The dishwasher is broken and not working. Could you arrange a repair please?',
        propertyId: property.id,
        senderContactId: tenantLink.contactId,
      });

      const process = createInboundWorkflow(db, {
        gateway: createAIGateway({ provider: createMockAIProvider(), db }),
        context: createBuildContext(db),
      });
      const outcome = await process(commId);
      expect(outcome.ok && outcome.value.status === 'PROCESSED' && outcome.value.approvalId !== null).toBe(true);
      if (!outcome.ok || outcome.value.status !== 'PROCESSED' || !outcome.value.approvalId || !outcome.value.aiActionId) return;

      const reviewer = await firstAdminId(db);
      const approvalsApi = createApprovalWorkflow(db);

      const edited = await approvalsApi.recordEditedDraft({
        approvalId: outcome.value.approvalId,
        userId: reviewer,
        finalOutput: {
          subject: 'Re: Dishwasher broken',
          bodyEn: 'HUMAN EDIT: technician booked for Wednesday 2pm. Please ensure someone is home.',
          bodyZh: '人工修订：技工已约周三下午2点，请确保家中有人。',
        },
      });
      expect(edited.ok).toBe(true);

      const feedbackRows = await db
        .select()
        .from(aiFeedbacks)
        .where(eq(aiFeedbacks.aiActionId, outcome.value.aiActionId));
      expect(feedbackRows.length).toBe(1);
      expect(feedbackRows[0]?.feedbackType).toBe('EDITED');

      await approvalsApi.approve({ approvalId: outcome.value.approvalId, reviewerId: reviewer });
      const executed = await approvalsApi.executeApproved({ approvalId: outcome.value.approvalId });
      expect(executed.ok).toBe(true);
      if (!executed.ok) return;

      const [sentComm] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, executed.value.communicationId!))
        .limit(1);
      expect(sentComm?.originalContent).toContain('HUMAN EDIT');
      expect(sentComm?.originalContent).not.toContain('Thank you for your email');
    } finally {
      await getPool(db).end();
    }
  });
});
