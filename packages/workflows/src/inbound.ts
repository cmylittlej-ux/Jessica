import { and, eq } from 'drizzle-orm';
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
import { bandOf, classifyActionRisk } from '@reos/domain';
import { recordAudit } from '@reos/audit';
import { confidenceBand, type AIGateway, type ContextMatcher } from '@reos/ai';
import { ok, err, type Result } from '@reos/shared';
import { WorkflowError } from './errors.ts';
import {
  matchCaseForMessage,
  matchContactByEmail,
  matchProperty,
  type PropertyMatch,
} from './matching.ts';

/**
 * Inbound communication workflow (Spec §26 + Hardening §3–§13).
 *
 * Order of operations — the low-confidence gate comes BEFORE any matching:
 *   receive → dedupe → AI classify (validated) → persist classification
 *   → LOW-CONFIDENCE GATE (no bypass) → contact/property matching
 *   → case matching (multi-factor, independent confidence)
 *   → translation (non-blocking) → task / reply draft / AIAction(risk)
 *   → approval → timeline + audit (correlationId end-to-end).
 *
 * Any AI or context failure parks the message in READY_FOR_REVIEW with an
 * AI_FAILED activity + technical audit. Nothing external ever executes from
 * this workflow.
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
  /** §4: independent from the classification confidence. */
  caseMatchConfidence: number | null;
  correlationId: string;
}

export interface InformationOutcome {
  status: 'INFORMATION_ONLY';
  communicationId: string;
  reason: 'NO_ACTION_REQUIRED';
  correlationId: string;
}

export interface NeedsReviewOutcome {
  status: 'NEEDS_REVIEW';
  communicationId: string;
  caseId: string;
  reason:
    | 'LOW_CONFIDENCE'
    | 'AI_FAILED'
    | 'PROPERTY_UNRESOLVED'
    | 'CASE_MATCH_NEEDS_REVIEW'
    | 'SENDER_AMBIGUOUS';
  suggestedCaseId?: string | null;
  caseMatchConfidence?: number | null;
  correlationId: string;
}

export interface DuplicateOutcome {
  status: 'DUPLICATE';
  communicationId: string;
}

export type InboundOutcome =
  | ProcessedOutcome
  | InformationOutcome
  | NeedsReviewOutcome
  | DuplicateOutcome;

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

/** Create the triage case used by every review path (never auto-linked). */
async function openReviewCase(
  db: ReosDatabase,
  input: {
    agencyId: string;
    propertyId: string | null;
    title: string;
    priority?: 'HIGH' | 'NORMAL';
  },
): Promise<string> {
  const created = await openCase(db, {
    id: `cas_${crypto.randomUUID()}`,
    agencyId: input.agencyId,
    propertyId: input.propertyId,
    title: input.title,
    businessDomain: 'UNKNOWN',
    caseType: 'OTHER_ADMIN',
    priority: input.priority ?? 'NORMAL',
    actorType: 'SYSTEM',
  });
  await db
    .update(cases)
    .set({ status: nextCaseStatus('NEW', 'READY_FOR_REVIEW'), updatedAt: new Date() })
    .where(eq(cases.id, created.id));
  return created.id;
}

export function createInboundWorkflow(
  db: ReosDatabase,
  deps: InboundWorkflowDeps,
): (communicationId: string) => Promise<Result<InboundOutcome, WorkflowError>> {
  const { gateway, context } = deps;

  return async (communicationId) => {
    const correlationId = `corr_${crypto.randomUUID()}`;

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
      // 3. AI classification with Zod validation inside the gateway.
      const inputResult = await context.buildClassificationInput(communicationId);
      if (!inputResult.ok) {
        throw new ReviewSignal('AI_FAILED', 'context builder failed', inputResult.error.message);
      }
      const classifiedResult = await gateway.classifyCommunication(inputResult.value);
      if (!classifiedResult.ok) {
        throw new ReviewSignal('AI_FAILED', 'AI classification failed', {
          code: classifiedResult.error.code,
          message: classifiedResult.error.message,
        });
      }
      const classified = classifiedResult.value;

      // 4. Persist the four-dimensional classification on the message itself (§11).
      await db
        .update(communications)
        .set({
          businessDomain: classified.businessDomain,
          caseType: classified.caseType,
          actionRequired: classified.actionRequired,
          classificationConfidence: classified.confidence,
          classifiedAt: new Date(),
          classificationSource: 'AI',
        })
        .where(eq(communications.id, communicationId));

      // ---------------------------------------------------------------------
      // 5. LOW-CONFIDENCE GATE (§3) — before ANY matching, no bypass.
      //    An existing same-property same-type case can never rescue it.
      // ---------------------------------------------------------------------
      if (bandOf(classified.confidence) === 'NEEDS_MANUAL_CLASSIFICATION') {
        const agencyId = await resolveAgency(db, message.propertyId ?? null);
        const reviewCaseId = await openReviewCase(db, {
          agencyId,
          propertyId: message.propertyId ?? null,
          title: message.subject ?? 'Unclassified inbound message',
        });
        await linkCommToCase(db, communicationId, reviewCaseId);
        await db.insert(activities).values({
          id: `actv_${crypto.randomUUID()}`,
          agencyId,
          propertyId: message.propertyId ?? null,
          caseId: reviewCaseId,
          actorType: 'AI',
          activityType: 'NEEDS_MANUAL_CLASSIFICATION',
          title: `Low confidence (${classified.confidence.toFixed(2)}) — manual triage required`,
          metadata: { communicationId, correlationId },
          occurredAt: new Date(),
        });
        await recordAudit(db, {
          actorType: 'AI',
          action: 'workflow.low_confidence_hold',
          entityType: 'Communication',
          entityId: communicationId,
          afterData: { caseId: reviewCaseId, confidence: classified.confidence },
          correlationId,
        });
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: reviewCaseId,
          reason: 'LOW_CONFIDENCE',
          correlationId,
        });
      }

      // ---------------------------------------------------------------------
      // 6. Contact matching pipeline (§27) — deterministic email lookup.
      // ---------------------------------------------------------------------
      let contactId = message.senderContactId ?? null;
      let propertyEvidence: PropertyMatch | null = message.propertyId
        ? { propertyId: message.propertyId, confidence: 1, reason: ['pre-linked'] }
        : null;

      if (!contactId) {
        const senderEmail =
          (message.senderData as { email?: string } | null)?.email ?? null;
        if (senderEmail) {
          const contactMatch = await matchContactByEmail(db, senderEmail);
          if (contactMatch.kind === 'MATCHED') {
            contactId = contactMatch.contactId;
            await db
              .update(communications)
              .set({ senderContactId: contactId, senderType: 'CONTACT' })
              .where(eq(communications.id, communicationId));
          } else if (contactMatch.candidates.length > 1) {
            // Ambiguous identity — human must decide; no fabricated relation.
            const agencyId = await resolveAgency(db, message.propertyId ?? null);
            const reviewCaseId = await openReviewCase(db, {
              agencyId,
              propertyId: message.propertyId ?? null,
              title: message.subject ?? 'Ambiguous sender',
            });
            await linkCommToCase(db, communicationId, reviewCaseId);
            await db.insert(activities).values({
              id: `actv_${crypto.randomUUID()}`,
              agencyId,
              propertyId: message.propertyId ?? null,
              caseId: reviewCaseId,
              actorType: 'SYSTEM',
              activityType: 'NEEDS_MANUAL_CLASSIFICATION',
              title: 'Sender matches multiple contacts — manual identification required',
              metadata: { communicationId, correlationId, candidates: contactMatch.candidates },
              occurredAt: new Date(),
            });
            await recordAudit(db, {
              actorType: 'SYSTEM',
              action: 'workflow.sender_ambiguous_hold',
              entityType: 'Communication',
              entityId: communicationId,
              afterData: { candidates: contactMatch.candidates },
              correlationId,
            });
            return ok({
              status: 'NEEDS_REVIEW',
              communicationId,
              caseId: reviewCaseId,
              reason: 'SENDER_AMBIGUOUS',
              correlationId,
            });
          }
          // Zero hits: keep EXTERNAL sender identity — do NOT invent a contact.
        }
      }

      // ---------------------------------------------------------------------
      // 7. Property matching pipeline (§28) — evidence-based, scored.
      // ---------------------------------------------------------------------
      if (!propertyEvidence) {
        const matched = await matchProperty(db, {
          contactId,
          externalConversationId: message.externalConversationId,
          text: `${message.subject ?? ''}\n${message.originalContent}`,
        });
        propertyEvidence = { ...matched };
      }

      // §26: informational traffic without reliable context is stored and
      // filed — never turned into a Case.
      const informational =
        classified.actionRequired === 'INFORMATION_ONLY' ||
        classified.actionRequired === 'NO_ACTION';

      if (!propertyEvidence.propertyId && !informational) {
        const agencyId = await resolveAgency(db, message.propertyId ?? null);
        const reviewCaseId = await openReviewCase(db, {
          agencyId,
          propertyId: null,
          title: message.subject ?? 'Unresolved property',
        });
        await linkCommToCase(db, communicationId, reviewCaseId);
        await db.insert(activities).values({
          id: `actv_${crypto.randomUUID()}`,
          agencyId,
          caseId: reviewCaseId,
          actorType: 'SYSTEM',
          activityType: 'NEEDS_MANUAL_CLASSIFICATION',
          title: 'Property could not be resolved reliably — manual routing required',
          metadata: { communicationId, correlationId, evidence: propertyEvidence },
          occurredAt: new Date(),
        });
        await recordAudit(db, {
          actorType: 'SYSTEM',
          action: 'workflow.property_unresolved_hold',
          entityType: 'Communication',
          entityId: communicationId,
          afterData: { evidence: propertyEvidence },
          correlationId,
        });
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: reviewCaseId,
          reason: 'PROPERTY_UNRESOLVED',
          correlationId,
        });
      }

      if (propertyEvidence.propertyId && message.propertyId !== propertyEvidence.propertyId) {
        await db
          .update(communications)
          .set({
            propertyId: propertyEvidence.propertyId,
            ...(contactId ? { senderContactId: contactId } : {}),
          })
          .where(eq(communications.id, communicationId));
      }

      // ---------------------------------------------------------------------
      // 8. Case Matcher (§4) — multi-factor, independent confidence.
      // ---------------------------------------------------------------------
      let caseRow: typeof cases.$inferSelect | undefined;
      let linked = false;
      let caseMatchConfidence: number | null = null;
      const caseMatch = await matchCaseForMessage(db, {
        propertyId: propertyEvidence.propertyId,
        contactId,
        externalConversationId: message.externalConversationId,
        caseType: classified.caseType,
        subject: message.subject ?? '',
        content: message.originalContent,
      });
      caseMatchConfidence = caseMatch.matchConfidence;

      if (caseMatch.decision === 'LINK' && caseMatch.caseId) {
        const [existing] = await db.select().from(cases).where(eq(cases.id, caseMatch.caseId)).limit(1);
        if (existing) {
          caseRow = existing;
          linked = true;
        }
      } else if (caseMatch.decision === 'SUGGEST' && caseMatch.caseId) {
        // §4 policy: suggest link, human review — no automation on a guess.
        const agencyId = await resolveAgency(db, propertyEvidence.propertyId);
        const reviewCaseId = await openReviewCase(db, {
          agencyId,
          propertyId: propertyEvidence.propertyId,
          title: message.subject ?? 'Case link needs review',
        });
        await linkCommToCase(db, communicationId, reviewCaseId);
        await db.insert(activities).values({
          id: `actv_${crypto.randomUUID()}`,
          agencyId,
          propertyId: propertyEvidence.propertyId,
          caseId: reviewCaseId,
          actorType: 'AI',
          activityType: 'NEEDS_MANUAL_CLASSIFICATION',
          title: `Suggested existing case "${caseMatch.suggestedCaseTitle}" (${(caseMatch.matchConfidence * 100).toFixed(0)}%) — confirm manually`,
          metadata: {
            communicationId,
            correlationId,
            suggestedCaseId: caseMatch.caseId,
            matchConfidence: caseMatch.matchConfidence,
            reasons: caseMatch.reason,
          },
          occurredAt: new Date(),
        });
        await recordAudit(db, {
          actorType: 'AI',
          action: 'workflow.case_match_suggested',
          entityType: 'Communication',
          entityId: communicationId,
          afterData: {
            suggestedCaseId: caseMatch.caseId,
            matchConfidence: caseMatch.matchConfidence,
            reasons: caseMatch.reason,
          },
          correlationId,
        });
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: reviewCaseId,
          reason: 'CASE_MATCH_NEEDS_REVIEW',
          suggestedCaseId: caseMatch.caseId,
          caseMatchConfidence: caseMatch.matchConfidence,
          correlationId,
        });
      }

      if (!caseRow) {
        const created = await openCase(db, {
          id: `cas_${crypto.randomUUID()}`,
          agencyId: await resolveAgency(db, propertyEvidence.propertyId),
          propertyId: propertyEvidence.propertyId ?? null,
          title: message.subject ?? classified.summaryEn,
          businessDomain:
            classified.businessDomain === 'UNKNOWN' ? 'ADMINISTRATION' : classified.businessDomain,
          caseType: classified.caseType === 'SPAM' ? 'OTHER_ADMIN' : classified.caseType,
          priority: classified.priority,
          assignedUserId: await findResponsibleUser(db),
          actorType: 'AI',
        });
        caseRow = created;
      }

      // 9. Save bilingual summaries onto the case + link the message to its
      // case so every surface (inbox list, detail, timeline) can join on it.
      await db
        .update(cases)
        .set({ summary: `${classified.summaryEn}\n${classified.summaryZh}`, updatedAt: new Date() })
        .where(eq(cases.id, caseRow.id));
      await linkCommToCase(db, communicationId, caseRow.id);

      const taskIds: string[] = [];
      let aiActionId: string | null = null;
      let approvalId: string | null = null;
      const now = new Date();

      // 10. Inbound translation (§9): Original stays immutable; a failure is
      // recorded but never affects the main flow — UI shows "translation failed".
      await translateInbound(db, gateway, communicationId, message.originalContent).catch(() => {});

      // 11. Create Task where appropriate (internal effect — no approval needed).
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

      // 12–14. Reply draft where appropriate → AIAction (with riskLevel +
      // correlationId) → Approval (risk snapshot). OFFER cases also get a
      // buyer acknowledgement draft (Spec §33); the decision itself remains
      // DECISION_REQUIRED for the vendor — never automated.
      if (classified.actionRequired === 'REPLY_REQUIRED' || classified.caseType === 'OFFER') {
        const replyContext = await context.buildCaseContext(caseRow.id);
        if (replyContext.ok) {
          const replyResult = await gateway.generateReply({
            caseContext: replyContext.value,
            originalMessage: { subject: message.subject, content: message.originalContent },
          });
          if (!replyResult.ok) {
            await db.insert(activities).values({
              id: `actv_${crypto.randomUUID()}`,
              agencyId: caseRow.agencyId,
              propertyId: caseRow.propertyId,
              caseId: caseRow.id,
              actorType: 'AI',
              activityType: 'REPLY_DRAFT_FAILED',
              title: 'Reply draft failed — case continues without automation',
              metadata: { communicationId, correlationId, reason: replyResult.error.message },
              occurredAt: now,
            });
          } else {
            const reply = replyResult.value;
            const risk = classifyActionRisk('GENERATE_REPLY');
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
              riskLevel: risk,
              correlationId,
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
              riskLevel: risk,
              status: 'PENDING',
              requestedAt: now,
            });
          }
        }
      }

      // 15–16. Timeline + audit trail (correlationId everywhere, §31).
      await db.insert(activities).values({
        id: `actv_${crypto.randomUUID()}`,
        agencyId: caseRow.agencyId,
        propertyId: caseRow.propertyId,
        caseId: caseRow.id,
        actorType: 'AI',
        activityType: 'INBOUND_PROCESSED',
        title: `Inbound processed: ${message.subject ?? '(no subject)'}`,
        description: classified.summaryEn,
        metadata: {
          communicationId,
          correlationId,
          confidence: classified.confidence,
          band: confidenceBand(classified.confidence),
          caseMatchConfidence,
          caseMatchReasons: linked ? caseMatch.reason : [],
          linkedCase: linked,
        },
        occurredAt: now,
      });
      await recordAudit(db, {
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
            actionRequired: classified.actionRequired,
            confidence: classified.confidence,
          },
          caseMatchConfidence,
          taskIds,
          aiActionId,
          approvalId,
        },
        correlationId,
        metadata: { workflow: 'inbound-v2-hardened' },
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
        caseMatchConfidence,
        correlationId,
      });
    } catch (cause) {
      // ---------------------------------------------------------------
      // Safe degradation (§5): every AI/context failure lands the message
      // in READY_FOR_REVIEW with AI_FAILED activity + technical audit —
      // the email is preserved, no relation fabricated, nothing executed.
      // ---------------------------------------------------------------
      const signal =
        cause instanceof ReviewSignal
          ? cause
          : new ReviewSignal(
              'AI_FAILED',
              cause instanceof Error ? cause.message : String(cause),
              cause instanceof Error ? cause.stack : undefined,
            );
      try {
        const agencyId = await resolveAgency(db, message.propertyId ?? null);
        const fallbackId = await openReviewCase(db, {
          agencyId,
          propertyId: message.propertyId ?? null,
          title: message.subject ?? 'AI processing failed',
          priority: 'HIGH',
        });
        await linkCommToCase(db, communicationId, fallbackId);
        await db.insert(activities).values({
          id: `actv_${crypto.randomUUID()}`,
          agencyId,
          propertyId: message.propertyId ?? null,
          caseId: fallbackId,
          actorType: 'SYSTEM',
          activityType: 'AI_FAILED',
          title: `AI processing failed — moved to review: ${signal.detail}`,
          metadata: { communicationId, correlationId, reason: signal.reason },
          occurredAt: new Date(),
        });
        await recordAudit(db, {
          actorType: 'SYSTEM',
          action: 'workflow.ai_failed_fallback',
          entityType: 'Communication',
          entityId: communicationId,
          afterData: { caseId: fallbackId, error: signal.detail },
          correlationId,
          metadata: { workflow: 'inbound-v2-hardened' },
        });
        return ok({
          status: 'NEEDS_REVIEW',
          communicationId,
          caseId: fallbackId,
          reason: signal.reason,
          correlationId,
        });
      } catch (fallbackCause) {
        return err(
          new WorkflowError(
            'DEPENDENCY_FAILURE',
            'inbound workflow failed and fallback case creation also failed',
            fallbackCause instanceof Error ? fallbackCause.message : String(fallbackCause),
          ),
        );
      }
    }
  };
}

// --- helpers -------------------------------------------------------------------

class ReviewSignal extends Error {
  constructor(
    public reason: 'AI_FAILED',
    public detail: unknown,
    public stackDetail?: unknown,
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

async function linkCommToCase(db: ReosDatabase, communicationId: string, caseId: string) {
  const [current] = await db
    .select({ caseId: communications.caseId })
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);
  if (current?.caseId !== caseId) {
    await db.update(communications).set({ caseId }).where(eq(communications.id, communicationId));
  }
}

/** Fire-and-forget zh translation of an inbound English email (§9). */
async function translateInbound(
  db: ReosDatabase,
  gateway: AIGateway,
  communicationId: string,
  content: string,
): Promise<void> {
  const result = await gateway.translate({ text: content, sourceLanguage: 'en', targetLanguage: 'zh' });
  if (result.ok) {
    await db
      .update(communications)
      .set({ translatedContentZh: result.value.translatedText })
      .where(eq(communications.id, communicationId));
  } else {
    // Derived data only — the original is intact; UI shows "translation failed".
    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID()}`,
      actorType: 'AI',
      action: 'communication.translation_failed',
      entityType: 'Communication',
      entityId: communicationId,
      afterData: { code: result.error.code, message: result.error.message },
      createdAt: new Date(),
    });
  }
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
