import { and, eq, inArray } from 'drizzle-orm';
import {
  activities,
  aiActions,
  approvals,
  auditLogs,
  cases,
  communications,
  properties,
  tasks,
  users,
  nextCaseStatus,
  openCase,
  type ReosDatabase,
} from '@reos/db';
import { confidenceBand, type AIGateway, type ContextMatcher } from '@reos/ai';
import { ok, err, type Result } from '@reos/shared';
import { WorkflowError } from './errors.ts';

/**
 * Inbound communication workflow (Spec §26) — the system's spine:
 * receive → deduplicate → deterministic sender/property match → AI
 * classification (validated) → link/create Case → bilingual summary →
 * recommended actions → Task where appropriate → Reply draft where
 * appropriate → AIAction → Approval → Activity → AuditLog.
 *
 * Low-confidence classifications never create relations or approvals — the
 * case goes to READY_FOR_REVIEW for manual triage (Spec §10, §34-C).
 */

export interface InboundWorkflowDeps {
  gateway: AIGateway;
  context: ContextMatcher;
}

export interface ProcessedOutcome {
  status: 'PROCESSED';
  communicationId: string;
  caseId: string;
  caseLinked: boolean;
  taskIds: string[];
  aiActionId: string | null;
  approvalId: string | null;
  confidence: number;
}

export interface NeedsReviewOutcome {
  status: 'NEEDS_REVIEW';
  communicationId: string;
  caseId: string;
  reason: 'LOW_CONFIDENCE' | 'AI_FAILED';
}

export interface DuplicateOutcome {
  status: 'DUPLICATE';
  communicationId: string;
}

export type InboundOutcome = ProcessedOutcome | NeedsReviewOutcome | DuplicateOutcome;

const FOLLOW_UP_HORIZON_MS = 3 * 24 * 3600 * 1000;

async function findResponsibleUser(db: ReosDatabase): Promise<string> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  if (admin) return admin.id;
  const [any] = await db.select({ id: users.id }).from(users).limit(1);
  if (!any) throw new WorkflowError('NOT_FOUND', 'no users exist — run the seed first');
  return any.id;
}

export function createInboundWorkflow(
  db: ReosDatabase,
  deps: InboundWorkflowDeps,
): (communicationId: string) => Promise<Result<InboundOutcome, WorkflowError>> {
  const { gateway, context } = deps;

  return async (communicationId) => {
    // 1. Receive communication.
    const [message] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, communicationId))
      .limit(1);
    if (!message) {
      return err(new WorkflowError('NOT_FOUND', `communication ${communicationId} not found`));
    }
    if (message.direction !== 'INBOUND') {
      return err(new WorkflowError('INVALID_STATE', 'workflow only accepts INBOUND communications'));
    }

    // 2. Deduplicate — an audit entry proves this email was already processed.
    const [seen] = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'workflow.process_inbound'), eq(auditLogs.entityId, communicationId)))
      .limit(1);
    if (seen) return ok({ status: 'DUPLICATE', communicationId });

    try {
      // 5 + 6. AI classification with Zod validation inside the gateway.
      const inputResult = await context.buildClassificationInput(communicationId);
      if (!inputResult.ok) {
        throw new WorkflowError('DEPENDENCY_FAILURE', 'context builder failed', inputResult.error.message);
      }
      const classifiedResult = await gateway.classifyCommunication(inputResult.value);
      if (!classifiedResult.ok) {
        // Spec §9/§29: AI failure → never lose the email, never create wrong
        // relations, go to Needs Review via the shared fallback below.
        throw new WorkflowError('DEPENDENCY_FAILURE', 'AI classification failed', {
          code: classifiedResult.error.code,
          message: classifiedResult.error.message,
        });
      }
      const classified = classifiedResult.value;

      // 7. Link or create Case.
      let caseRow: typeof cases.$inferSelect | undefined;
      let linked = false;
      if (message.propertyId) {
        const [existing] = await db
          .select()
          .from(cases)
          .where(
            and(
              eq(cases.propertyId, message.propertyId),
              eq(cases.caseType, classified.caseType),
              inArray(cases.status, ['NEW', 'AI_PROCESSING', 'READY_FOR_REVIEW', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_DUE'] as const),
            ),
          )
          .orderBy(cases.openedAt)
          .limit(1);
        caseRow = existing;
        linked = Boolean(existing);
      }

      const band = confidenceBand(classified.confidence);

      // Low-confidence guard (Spec §10 / §34-C): no relations, no automation.
      if (!caseRow && band === 'NEEDS_MANUAL_CLASSIFICATION') {
        const now = new Date();
        const created = await openCase(db, {
          id: `cas_${crypto.randomUUID()}`,
          agencyId: (await resolveAgency(db, message.propertyId)),
          propertyId: message.propertyId ?? null,
          title: message.subject ?? 'Unclassified inbound message',
          businessDomain: 'UNKNOWN',
          caseType: 'OTHER_ADMIN',
          priority: 'NORMAL',
          actorType: 'SYSTEM',
        });
        await db
          .update(cases)
          .set({ status: nextCaseStatus('NEW', 'READY_FOR_REVIEW'), updatedAt: now })
          .where(eq(cases.id, created.id));
        await db.insert(activities).values({
          id: `actv_${crypto.randomUUID()}`,
          agencyId: created.agencyId,
          propertyId: message.propertyId ?? null,
          caseId: created.id,
          actorType: 'AI',
          activityType: 'NEEDS_MANUAL_CLASSIFICATION',
          title: `Low confidence (${classified.confidence.toFixed(2)}) — manual triage required`,
          metadata: { communicationId },
          occurredAt: now,
        });
        await db.insert(auditLogs).values({
          id: `aud_${crypto.randomUUID()}`,
          actorType: 'AI',
          action: 'workflow.low_confidence_hold',
          entityType: 'Communication',
          entityId: communicationId,
          afterData: { caseId: created.id, confidence: classified.confidence },
          createdAt: now,
        });
        // Link the held message to its triage case for UI navigation.
        if (message.caseId !== created.id) {
          await db
            .update(communications)
            .set({ caseId: created.id })
            .where(eq(communications.id, communicationId));
        }
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: created.id,
          reason: 'LOW_CONFIDENCE',
        });
      }

      if (!caseRow) {
        const created = await openCase(db, {
          id: `cas_${crypto.randomUUID()}`,
          agencyId: await resolveAgency(db, message.propertyId),
          propertyId: message.propertyId ?? null,
          title: message.subject ?? classified.summaryEn,
          businessDomain: classified.businessDomain === 'UNKNOWN' ? 'ADMINISTRATION' : classified.businessDomain,
          caseType: classified.caseType === 'SPAM' ? 'OTHER_ADMIN' : classified.caseType,
          priority: classified.priority,
          assignedUserId: await findResponsibleUser(db),
          actorType: 'AI',
        });
        caseRow = created;
      }

      // 8. Save bilingual summaries onto the case + link the message to its
      // case so every surface (inbox list, detail, timeline) can join on it.
      await db
        .update(cases)
        .set({ summary: `${classified.summaryEn}\n${classified.summaryZh}`, updatedAt: new Date() })
        .where(eq(cases.id, caseRow.id));
      if (message.caseId !== caseRow.id) {
        await db
          .update(communications)
          .set({ caseId: caseRow.id })
          .where(eq(communications.id, communicationId));
      }

      const taskIds: string[] = [];
      let aiActionId: string | null = null;
      let approvalId: string | null = null;
      const now = new Date();

      // 10. Create Task where appropriate (internal effect — no approval needed).
      const wantsFollowUp =
        classified.recommendedActions.some((a) => a.type === 'CREATE_FOLLOW_UP') ||
        classified.actionRequired === 'FOLLOW_UP_REQUIRED' ||
        classified.recommendedActions.some((a) => a.type === 'SCHEDULE_TRADESPERSON');
      if (wantsFollowUp) {
        const taskId = `tsk_${crypto.randomUUID()}`;
        await db.insert(tasks).values({
          id: taskId,
          caseId: caseRow.id,
          assignedUserId: caseRow.assignedUserId ?? (await findResponsibleUser(db)),
          title: `Follow up: ${classified.summaryEn}`,
          description: classified.recommendedActions.map((a) => `${a.type}: ${a.reason}`).join('\n'),
          status: 'OPEN',
          source: 'AI',
          dueAt: new Date(now.getTime() + FOLLOW_UP_HORIZON_MS),
          createdAt: now,
          updatedAt: now,
        });
        taskIds.push(taskId);
      }

      // 11–13. Generate reply draft where appropriate → AIAction → Approval.
      // OFFER cases also get a buyer acknowledgement draft (Spec §33) even
      // though the decision itself is DECISION_REQUIRED for the vendor.
      if (classified.actionRequired === 'REPLY_REQUIRED' || classified.caseType === 'OFFER') {
        const replyContext = await context.buildCaseContext(caseRow.id);
        if (replyContext.ok) {
          const replyResult = await gateway.generateReply({
            caseContext: replyContext.value,
            originalMessage: { subject: message.subject, content: message.originalContent },
          });
          // Reply generation is optional polish — skip on failure rather than
          // losing the whole classification (Spec §29).
          if (!replyResult.ok) {
            await db.insert(activities).values({
              id: `actv_${crypto.randomUUID()}`,
              agencyId: caseRow.agencyId,
              propertyId: message.propertyId ?? null,
              caseId: caseRow.id,
              actorType: 'AI',
              activityType: 'REPLY_DRAFT_FAILED',
              title: 'Reply draft failed — case continues without automation',
              metadata: { communicationId, reason: replyResult.error.message },
              occurredAt: now,
            });
          } else {
            const reply = replyResult.value;
            const actionId = `aia_${crypto.randomUUID()}`;
            await db.insert(aiActions).values({
              id: actionId,
              caseId: caseRow.id,
              actionType: 'GENERATE_REPLY',
              provider: 'mock',
              model: 'mock-1',
              inputSummary: message.subject,
              proposedPayload: reply,
              confidence: reply.confidence,
              status: 'PROPOSED',
              createdAt: now,
            });
            aiActionId = actionId;
            approvalId = `apr_${crypto.randomUUID()}`;
            await db.insert(approvals).values({
              id: approvalId,
              caseId: caseRow.id,
              actionId,
              requestedUserId: caseRow.assignedUserId ?? (await findResponsibleUser(db)),
              status: 'PENDING',
              requestedAt: now,
            });
          }
        }
      }

      // 14 + 15. Timeline + audit trail.
      await db.insert(activities).values({
        id: `actv_${crypto.randomUUID()}`,
        agencyId: caseRow.agencyId,
        propertyId: message.propertyId ?? null,
        caseId: caseRow.id,
        actorType: 'AI',
        activityType: 'INBOUND_PROCESSED',
        title: `Inbound processed: ${message.subject ?? '(no subject)'}`,
        description: classified.summaryEn,
        metadata: {
          communicationId,
          confidence: classified.confidence,
          band,
          linkedCase: linked,
        },
        occurredAt: now,
      });
      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID()}`,
        actorType: 'AI',
        action: 'workflow.process_inbound',
        entityType: 'Communication',
        entityId: communicationId,
        afterData: {
          caseId: caseRow.id,
          caseLinked: linked,
          classification: {
            businessDomain: classified.businessDomain,
            caseType: classified.caseType,
            confidence: classified.confidence,
          },
          taskIds,
          aiActionId,
          approvalId,
        },
        metadata: { workflow: 'inbound-v1' },
        createdAt: now,
      });

      return ok({
        status: 'PROCESSED',
        communicationId,
        caseId: caseRow.id,
        caseLinked: linked,
        taskIds,
        aiActionId,
        approvalId,
        confidence: classified.confidence,
      });
    } catch (cause) {
      if (cause instanceof WorkflowError) return err(cause);

      // Spec §29: AI failure must not lose the email nor create wrong
      // relations — park it in a review case instead.
      try {
        const fallback = await openCase(db, {
          id: `cas_${crypto.randomUUID()}`,
          agencyId: await resolveAgency(db, message.propertyId),
          propertyId: message.propertyId ?? null,
          title: message.subject ?? 'AI processing failed',
          businessDomain: 'UNKNOWN',
          caseType: 'OTHER_ADMIN',
          priority: 'HIGH',
          actorType: 'SYSTEM',
        });
        await db
          .update(cases)
          .set({ status: nextCaseStatus('NEW', 'READY_FOR_REVIEW'), updatedAt: new Date() })
          .where(eq(cases.id, fallback.id));
        if (message.caseId !== fallback.id) {
          await db
            .update(communications)
            .set({ caseId: fallback.id })
            .where(eq(communications.id, communicationId));
        }
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: fallback.id,
          reason: 'AI_FAILED',
        });
      } catch {
        return err(
          new WorkflowError(
            'DEPENDENCY_FAILURE',
            'inbound workflow failed and fallback case creation also failed',
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }
    }
  };
}

async function resolveAgency(db: ReosDatabase, propertyId: string | null | undefined): Promise<string> {
  if (propertyId) {
    const [property] = await db
      .select({ agencyId: properties.agencyId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    if (property) return property.agencyId;
  }
  const [anyProperty] = await db.select({ agencyId: properties.agencyId }).from(properties).limit(1);
  if (!anyProperty) throw new WorkflowError('NOT_FOUND', 'no agency resolvable — run the seed first');
  return anyProperty.agencyId;
}
