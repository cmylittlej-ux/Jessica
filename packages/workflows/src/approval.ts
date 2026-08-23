import { eq } from 'drizzle-orm';
import {
  aiActions,
  aiFeedbacks,
  approvals,
  auditLogs,
  nextAiActionStatus,
  nextApprovalStatus,
  type ReosDatabase,
} from '@reos/db';
import { createMockEmailConnector } from '@reos/connectors';
import { ok, err, type Result } from '@reos/shared';
import { WorkflowError } from './errors.ts';

/**
 * Approval workflow (Spec §27/§28). The only path from an AI proposal to an
 * external effect:
 *
 *   AIAction.PROPOSED → Approval.PENDING → (user approves) → AIAction.APPROVED
 *   → mock execution → AIAction.EXECUTED → Communication.SENT → Timeline + Audit
 *
 * Rejection never executes. Edited drafts keep the AI original, the human
 * final version and an AIFeedback=EDITED row (Spec §28).
 */

export interface DecisionInput {
  approvalId: string;
  reviewerId: string;
  decisionNote?: string;
}

function fail(code: WorkflowError['code'], message: string, details?: unknown) {
  return err(new WorkflowError(code, message, details));
}

export function createApprovalWorkflow(db: ReosDatabase) {
  const email = createMockEmailConnector(db);

  return {
    /** PENDING → APPROVED for both the approval and its AIAction. */
    async approve(input: DecisionInput): Promise<Result<{ approvalId: string; actionId: string }, WorkflowError>> {
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
      if (!approval) return fail('NOT_FOUND', `approval ${input.approvalId} not found`);
      if (approval.status !== 'PENDING') {
        return fail('INVALID_STATE', `approval is ${approval.status}, only PENDING can be approved`);
      }

      const now = new Date();
      await db
        .update(approvals)
        .set({
          status: nextApprovalStatus('PENDING', 'APPROVED'),
          reviewedAt: now,
          reviewedBy: input.reviewerId,
          decisionNote: input.decisionNote ?? null,
        })
        .where(eq(approvals.id, approval.id));

      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
      if (!action) return fail('NOT_FOUND', `AIAction ${approval.actionId} not found`);
      if (action.status !== 'PROPOSED') {
        return fail('INVALID_STATE', `AIAction is ${action.status}, expected PROPOSED`);
      }
      await db
        .update(aiActions)
        .set({ status: nextAiActionStatus('PROPOSED', 'APPROVED') })
        .where(eq(aiActions.id, action.id));

      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID()}`,
        actorType: 'USER',
        actorId: input.reviewerId,
        action: 'approval.approved',
        entityType: 'Approval',
        entityId: approval.id,
        afterData: { actionId: action.id, note: input.decisionNote ?? null },
        createdAt: now,
      });
      return ok({ approvalId: approval.id, actionId: action.id });
    },

    /**
     * §28: user edited the AI draft before approving. Keeps AI original in
     * proposedPayload, stores the human version in finalPayload and records
     * an AIFeedback=EDITED training signal.
     */
    async recordEditedDraft(input: {
      approvalId: string;
      userId: string;
      finalOutput: Record<string, unknown>;
    }): Promise<Result<{ feedbackId: string }, WorkflowError>> {
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
      if (!approval) return fail('NOT_FOUND', `approval ${input.approvalId} not found`);
      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
      if (!action) return fail('NOT_FOUND', `AIAction ${approval.actionId} not found`);
      if (action.status !== 'PROPOSED') {
        return fail('INVALID_STATE', 'edits are only allowed while the action is PROPOSED');
      }

      const feedbackId = `fed_${crypto.randomUUID()}`;
      await db.insert(aiFeedbacks).values({
        id: feedbackId,
        aiActionId: action.id,
        userId: input.userId,
        originalOutput: action.proposedPayload,
        finalOutput: input.finalOutput,
        feedbackType: 'EDITED',
      });
      await db.update(aiActions).set({ finalPayload: input.finalOutput }).where(eq(aiActions.id, action.id));
      return ok({ feedbackId });
    },

    /** PENDING → REJECTED. The AIAction is rejected and never executes. */
    async reject(input: DecisionInput): Promise<Result<{ approvalId: string }, WorkflowError>> {
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
      if (!approval) return fail('NOT_FOUND', `approval ${input.approvalId} not found`);
      if (approval.status !== 'PENDING') {
        return fail('INVALID_STATE', `approval is ${approval.status}, only PENDING can be rejected`);
      }

      const now = new Date();
      await db
        .update(approvals)
        .set({
          status: nextApprovalStatus('PENDING', 'REJECTED'),
          reviewedAt: now,
          reviewedBy: input.reviewerId,
          decisionNote: input.decisionNote ?? null,
        })
        .where(eq(approvals.id, approval.id));

      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
      if (action && action.status === 'PROPOSED') {
        await db
          .update(aiActions)
          .set({ status: nextAiActionStatus('PROPOSED', 'REJECTED') })
          .where(eq(aiActions.id, action.id));
      }

      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID()}`,
        actorType: 'USER',
        actorId: input.reviewerId,
        action: 'approval.rejected',
        entityType: 'Approval',
        entityId: approval.id,
        afterData: { actionId: approval.actionId, note: input.decisionNote ?? null },
        createdAt: now,
      });
      return ok({ approvalId: approval.id });
    },

    /**
     * Mock execution of an APPROVED action (Spec §27): GENERATE_REPLY /
     * SEND_EMAIL go through MockEmailConnector.send — recording SENT status,
     * Activity, AuditLog and the final content verbatim — then the AIAction
     * becomes EXECUTED.
     */
    async executeApproved(input: {
      approvalId: string;
      actorId?: string;
    }): Promise<Result<{ actionId: string; communicationId: string | null }, WorkflowError>> {
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
      if (!approval) return fail('NOT_FOUND', `approval ${input.approvalId} not found`);
      if (approval.status !== 'APPROVED') {
        return fail('INVALID_STATE', `approval is ${approval.status} — approve before executing`);
      }
      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
      if (!action) return fail('NOT_FOUND', `AIAction ${approval.actionId} not found`);
      if (action.status !== 'APPROVED') {
        return fail('INVALID_STATE', `AIAction is ${action.status}, expected APPROVED`);
      }

      const payload = (action.finalPayload ?? action.proposedPayload) as {
        subject?: string;
        bodyEn?: string;
        bodyZh?: string;
      };

      let communicationId: string | null = null;
      if (action.actionType === 'GENERATE_REPLY' || action.actionType === 'SEND_EMAIL') {
        if (!payload.bodyEn) {
          // Mark FAILED rather than failing silently (Spec §29).
          await db
            .update(aiActions)
            .set({ status: nextAiActionStatus('APPROVED', 'FAILED') })
            .where(eq(aiActions.id, action.id));
          return fail('DEPENDENCY_FAILURE', 'approved reply payload has no bodyEn to send');
        }
        const sent = await email.send({
          caseId: action.caseId,
          subject: payload.subject ?? 'Re: your enquiry',
          content: payload.bodyEn,
          language: 'en',
          recipients: { via: 'approval-workflow', approvalId: approval.id },
        });
        if (!sent.ok) {
          await db
            .update(aiActions)
            .set({ status: nextAiActionStatus('APPROVED', 'FAILED') })
            .where(eq(aiActions.id, action.id));
          return fail('DEPENDENCY_FAILURE', 'mock send failed', sent.error.message);
        }
        communicationId = sent.value.communicationId;
      }

      await db
        .update(aiActions)
        .set({ status: nextAiActionStatus('APPROVED', 'EXECUTED'), executedAt: new Date() })
        .where(eq(aiActions.id, action.id));

      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID()}`,
        actorType: 'SYSTEM',
        actorId: input.actorId,
        action: 'approval.executed',
        entityType: 'AIAction',
        entityId: action.id,
        afterData: { approvalId: approval.id, communicationId },
        metadata: { mock: true },
        createdAt: new Date(),
      });

      return ok({ actionId: action.id, communicationId });
    },
  };
}
