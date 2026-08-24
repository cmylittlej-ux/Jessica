import { eq } from 'drizzle-orm';
import {
  actionExecutions,
  aiActions,
  aiFeedbacks,
  approvals,
  cases,
  nextAiActionStatus,
  nextApprovalStatus,
  nextCaseStatus,
  type ReosDatabase,
} from '@reos/db';
import { statusAfterReplySent } from '@reos/domain';
import { recordAudit } from '@reos/audit';
import { createMockEmailConnector } from '@reos/connectors';
import { ok, err, type Result } from '@reos/shared';
import { WorkflowError } from './errors.ts';

/**
 * Approval workflow (Spec §27/§28 + Hardening §13–§15). The only path from an
 * AI proposal to an external effect:
 *
 *   AIAction.PROPOSED → Approval.PENDING → (user approves, in one TRANSACTION)
 *   → AIAction.APPROVED → outbox ActionExecution (unique executionKey)
 *   → mock send → AIAction.EXECUTED → Communication.SENT
 *   → case moves to WAITING with its follow-up task (status closure, §13).
 *
 * Rejection never executes. Every execution is idempotent: replaying the same
 * executionKey can never produce a duplicate outbound email (§15).
 */

export interface DecisionInput {
  approvalId: string;
  reviewerId: string;
  decisionNote?: string;
}

/**
 * P0 Closure §3: an EXECUTING lock older than this is considered abandoned
 * (process crashed mid-send) and may be re-claimed for recovery. Fresh locks
 * are absolute — a second caller never reaches the connector.
 */
const STALE_EXECUTING_TIMEOUT_MS = 60_000;

function fail(code: WorkflowError['code'], message: string, details?: unknown) {
  return err(new WorkflowError(code, message, details));
}

export function createApprovalWorkflow(db: ReosDatabase) {
  const email = createMockEmailConnector(db);

  return {
    /** PENDING → APPROVED for both the approval and its AIAction — atomic. */
    async approve(input: DecisionInput): Promise<Result<{ approvalId: string; actionId: string }, WorkflowError>> {
      try {
        const result = await db.transaction(async (tx) => {
          const [approval] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
          if (!approval) throw new WorkflowError('NOT_FOUND', `approval ${input.approvalId} not found`);
          if (approval.status !== 'PENDING') {
            throw new WorkflowError('INVALID_STATE', `approval is ${approval.status}, only PENDING can be approved`);
          }

          const [action] = await tx.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
          if (!action) throw new WorkflowError('NOT_FOUND', `AIAction ${approval.actionId} not found`);
          if (action.status !== 'PROPOSED') {
            throw new WorkflowError('INVALID_STATE', `AIAction is ${action.status}, expected PROPOSED`);
          }

          const now = new Date();
          await tx
            .update(approvals)
            .set({
              status: nextApprovalStatus('PENDING', 'APPROVED'),
              reviewedAt: now,
              reviewedBy: input.reviewerId,
              decisionNote: input.decisionNote ?? null,
            })
            .where(eq(approvals.id, approval.id));

          await tx
            .update(aiActions)
            .set({ status: nextAiActionStatus('PROPOSED', 'APPROVED') })
            .where(eq(aiActions.id, action.id));

          // Audit inside the same transaction (§14) so an APPROVED state can
          // never exist without its audit trail.
          await recordAudit(tx, {
            actorType: 'USER',
            actorId: input.reviewerId,
            action: 'approval.approved',
            entityType: 'Approval',
            entityId: approval.id,
            caseId: approval.caseId,
            afterData: { actionId: action.id, note: input.decisionNote ?? null },
            correlationId: action.correlationId ?? null,
          });
          return { approvalId: approval.id, actionId: action.id };
        });
        return ok(result);
      } catch (cause) {
        if (cause instanceof WorkflowError) return fail(cause.code, cause.message, cause.details);
        return fail('DEPENDENCY_FAILURE', 'approve transaction failed',
          cause instanceof Error ? cause.message : String(cause));
      }
    },

    /**
     * §28: user edited the AI draft before approving. Keeps the AI original
     * in proposedPayload, stores the human version in finalPayload and records
     * an AIFeedback=EDITED training signal.
     */
    async recordEditedDraft(input: {
      approvalId: string;
      userId: string;
      finalOutput: Record<string, unknown>;
    }): Promise<Result<{ feedbackId: string }, WorkflowError>> {
      try {
        const result = await db.transaction(async (tx) => {
          const [approval] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
          if (!approval) throw new WorkflowError('NOT_FOUND', `approval ${input.approvalId} not found`);
          const [action] = await tx.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
          if (!action) throw new WorkflowError('NOT_FOUND', `AIAction ${approval.actionId} not found`);
          if (action.status !== 'PROPOSED') {
            throw new WorkflowError('INVALID_STATE', 'edits are only allowed while the action is PROPOSED');
          }

          const feedbackId = `fed_${crypto.randomUUID()}`;
          await tx.insert(aiFeedbacks).values({
            id: feedbackId,
            aiActionId: action.id,
            userId: input.userId,
            originalOutput: action.proposedPayload,
            finalOutput: input.finalOutput,
            feedbackType: 'EDITED',
          });
          await tx.update(aiActions).set({ finalPayload: input.finalOutput }).where(eq(aiActions.id, action.id));
          return { feedbackId };
        });
        return ok(result);
      } catch (cause) {
        if (cause instanceof WorkflowError) return fail(cause.code, cause.message, cause.details);
        return fail('DEPENDENCY_FAILURE', 'edit-draft transaction failed',
          cause instanceof Error ? cause.message : String(cause));
      }
    },

    /** PENDING → REJECTED — atomic; the AIAction never executes. */
    async reject(input: DecisionInput): Promise<Result<{ approvalId: string }, WorkflowError>> {
      try {
        const result = await db.transaction(async (tx) => {
          const [approval] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
          if (!approval) throw new WorkflowError('NOT_FOUND', `approval ${input.approvalId} not found`);
          if (approval.status !== 'PENDING') {
            throw new WorkflowError('INVALID_STATE', `approval is ${approval.status}, only PENDING can be rejected`);
          }

          const now = new Date();
          await tx
            .update(approvals)
            .set({
              status: nextApprovalStatus('PENDING', 'REJECTED'),
              reviewedAt: now,
              reviewedBy: input.reviewerId,
              decisionNote: input.decisionNote ?? null,
            })
            .where(eq(approvals.id, approval.id));

          const [action] = await tx.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
          if (action && action.status === 'PROPOSED') {
            await tx
              .update(aiActions)
              .set({ status: nextAiActionStatus('PROPOSED', 'REJECTED') })
              .where(eq(aiActions.id, action.id));
          }

          await recordAudit(tx, {
            actorType: 'USER',
            actorId: input.reviewerId,
            action: 'approval.rejected',
            entityType: 'Approval',
            entityId: approval.id,
            caseId: approval.caseId,
            afterData: { actionId: approval.actionId, note: input.decisionNote ?? null },
            correlationId: action?.correlationId ?? null,
          });
          return { approvalId: approval.id };
        });
        return ok(result);
      } catch (cause) {
        if (cause instanceof WorkflowError) return fail(cause.code, cause.message, cause.details);
        return fail('DEPENDENCY_FAILURE', 'reject transaction failed',
          cause instanceof Error ? cause.message : String(cause));
      }
    },

    /**
     * Execute an APPROVED action through the OUTBOX (§15 + P0 Closure §3):
     *   1. claim the unique ActionExecution row (executionKey),
     *   2. run the mock connector send,
     *   3. mark EXECUTED with the receipt as externalRef.
     *
     * Concurrency: only ONE caller may hold the EXECUTING lock for a key.
     * A second caller sees EXECUTING (fresh claim) and returns a SAFE NO-OP —
     * it never reaches the connector.
     * Crash recovery: an EXECUTING row older than the stale timeout is
     * considered abandoned and may be re-claimed exactly once per attempt;
     * until then every other caller fails closed rather than double-sending.
     */
    async executeApproved(input: {
      approvalId: string;
      actorId?: string;
    }): Promise<Result<{ actionId: string; communicationId: string | null; idempotentReplay?: boolean }, WorkflowError>> {
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
      if (!approval) return fail('NOT_FOUND', `approval ${input.approvalId} not found`);
      if (approval.status !== 'APPROVED') {
        return fail('INVALID_STATE', `approval is ${approval.status} — approve before executing`);
      }
      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, approval.actionId)).limit(1);
      if (!action) return fail('NOT_FOUND', `AIAction ${approval.actionId} not found`);

      // ---- Step 1: claim the execution slot atomically ----------------------
      const executionKey = `exec:${approval.id}:${action.id}`;
      let claimedFresh = false;
      let blockedByExecuting = false;
      try {
        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(actionExecutions)
            .where(eq(actionExecutions.executionKey, executionKey))
            .limit(1);

          if (existing?.status === 'EXECUTED') return; // idempotent replay

          if (existing?.status === 'EXECUTING') {
            const claimedAt = existing.claimedAt ?? existing.createdAt;
            const staleMs = STALE_EXECUTING_TIMEOUT_MS;
            if (Date.now() - claimedAt.getTime() < staleMs) {
              // Fresh lock held by a live worker — NEVER send concurrently.
              blockedByExecuting = true;
              return;
            }
            // Stale lock from a crashed worker — re-claim and retry once.
            await tx
              .update(actionExecutions)
              .set({ status: 'EXECUTING', claimedAt: new Date(), attempts: existing.attempts + 1 })
              .where(eq(actionExecutions.executionKey, executionKey));
            claimedFresh = true;
            return;
          }

          if (existing?.status === 'FAILED') return; // failed stays failed — manual review

          await tx.insert(actionExecutions).values({
            id: `aex_${crypto.randomUUID()}`,
            actionId: action.id,
            executionKey,
            status: 'EXECUTING',
            attempts: 1,
            claimedAt: new Date(),
            correlationId: action.correlationId ?? null,
            createdAt: new Date(),
          });
          claimedFresh = true;
        });
      } catch (cause) {
        return fail('DEPENDENCY_FAILURE', 'outbox claim failed',
          cause instanceof Error ? cause.message : String(cause));
      }

      // Concurrent caller: the effect is already being produced elsewhere.
      // Fail closed with a safe no-op — never a second connector call.
      if (blockedByExecuting) {
        return ok({ actionId: action.id, communicationId: null, idempotentReplay: true });
      }

      // Idempotent replay path: find what already happened.
      const [alreadyDone] = await db
        .select()
        .from(actionExecutions)
        .where(eq(actionExecutions.executionKey, executionKey))
        .limit(1);
      if (!claimedFresh && alreadyDone?.status === 'EXECUTED') {
        return ok({
          actionId: action.id,
          communicationId: null,
          idempotentReplay: true,
        });
      }

      // ---- Step 2–3: perform the effect, then close out the execution -------
      const finishTx = async (
        status: 'EXECUTED' | 'FAILED',
        patch: { communicationId?: string | null; externalRef?: string | null; lastError?: string | null },
      ) => {
        await db.transaction(async (tx) => {
          await tx
            .update(actionExecutions)
            .set({
              status,
              executedAt: new Date(),
              externalRef: patch.externalRef ?? null,
              lastError: patch.lastError ?? null,
            })
            .where(eq(actionExecutions.executionKey, executionKey));

          if (status === 'FAILED') {
            if (action.status === 'APPROVED') {
              await tx
                .update(aiActions)
                .set({ status: nextAiActionStatus('APPROVED', 'FAILED') })
                .where(eq(aiActions.id, action.id));
            }
          } else {
            await tx
              .update(aiActions)
              .set({ status: nextAiActionStatus('APPROVED', 'EXECUTED'), executedAt: new Date() })
              .where(eq(aiActions.id, action.id));
          }

          await recordAudit(tx, {
            actorType: 'SYSTEM',
            actorId: input.actorId,
            action: status === 'EXECUTED' ? 'approval.executed' : 'approval.execute_failed',
            entityType: 'AIAction',
            entityId: action.id,
            caseId: action.caseId,
            afterData: { approvalId: approval.id, executionKey, ...patch },
            correlationId: action.correlationId ?? null,
            metadata: { mock: true },
          });

          // §13 status closure: a sent reply means we now wait on the customer.
          if (status === 'EXECUTED' && action.caseId) {
            const [parentCase] = await tx.select().from(cases).where(eq(cases.id, action.caseId)).limit(1);
            if (parentCase && ['IN_PROGRESS', 'READY_FOR_REVIEW', 'NEW'].includes(parentCase.status)) {
              const target = statusAfterReplySent(parentCase.status as Parameters<typeof nextCaseStatus>[0]);
              await tx
                .update(cases)
                .set({ status: nextCaseStatus(parentCase.status as Parameters<typeof nextCaseStatus>[0], target), updatedAt: new Date() })
                .where(eq(cases.id, parentCase.id));
            }
          }
        });
      };

      if (action.actionType === 'GENERATE_REPLY' || action.actionType === 'SEND_EMAIL') {
        const payload = (action.finalPayload ?? action.proposedPayload) as {
          subject?: string;
          bodyEn?: string;
        };
        if (!payload.bodyEn) {
          await finishTx('FAILED', { lastError: 'approved reply payload has no bodyEn to send' });
          return fail('DEPENDENCY_FAILURE', 'approved reply payload has no bodyEn to send');
        }
        const sent = await email.send({
          caseId: action.caseId,
          subject: payload.subject ?? '(no subject)',
          content: payload.bodyEn,
          language: 'en',
          recipients: { via: 'approval-workflow', approvalId: approval.id },
          idempotencyKey: executionKey,
        });
        if (!sent.ok) {
          await finishTx('FAILED', { lastError: sent.error.message });
          return fail('DEPENDENCY_FAILURE', 'mock send failed', sent.error.message);
        }
        await finishTx('EXECUTED', { communicationId: sent.value.communicationId, externalRef: sent.value.communicationId });
        return ok({ actionId: action.id, communicationId: sent.value.communicationId });
      }

      // Non-external action types complete without a connector call.
      await finishTx('EXECUTED', { externalRef: null });
      return ok({ actionId: action.id, communicationId: null });
    },
  };
}
