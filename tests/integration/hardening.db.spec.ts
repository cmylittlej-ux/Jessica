import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAIGateway, createBuildContext, createMockAIProvider } from '../../packages/ai/src/index.ts';
import {
  createApprovalWorkflow,
  createInboundWorkflow,
  ingestRawEmail,
  matchCaseForMessage,
} from '../../packages/workflows/src/index.ts';
import {
  actionExecutions,
  activities,
  approvals,
  auditLogs,
  cases,
  communications,
  users,
} from '../../packages/db/src/schema/index.ts';
import { createDb, getPool } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/**
 * Hardening integration evidence (Spec §33, §35, §36, §37).
 * These complement the Playwright E2E by asserting database-level guarantees
 * that have no UI surface — idempotency keys, outbox replay, failure trails.
 */

describe.skipIf(!hasDb)('Hardening — Case Matcher targeting (§33)', () => {
  it('links a hot-water email to the hot-water case, not the dishwasher case', async () => {
    await seedDatabase();
    const db = createDb();

    const decision = await matchCaseForMessage(db, {
      propertyId: 'prp_901',
      contactId: 'con_901',
      caseType: 'MAINTENANCE',
      subject: 'Hot water unit still leaking',
      content: 'The hot water unit is still leaking since yesterday, water pooling in the garage.',
    });

    expect(decision.decision).toBe('LINK');
    expect(decision.caseId).toBe('cas_902'); // Hot water system failure
    expect(decision.matchConfidence).toBeGreaterThanOrEqual(0.9);
    await getPool(db).end();
  });

  it('links a dishwasher email to the dishwasher case', async () => {
    await seedDatabase();
    const db = createDb();

    const decision = await matchCaseForMessage(db, {
      propertyId: 'prp_901',
      contactId: 'con_901',
      caseType: 'MAINTENANCE',
      subject: 'Dishwasher not working',
      content: 'The dishwasher is broken and not working, could you arrange a repair?',
    });

    expect(decision.caseId).toBe('cas_901'); // Dishwasher failure
    await getPool(db).end();
  });
});

describe.skipIf(!hasDb)('Hardening — safe degradation & idempotency (§35/§36/§37)', () => {
  it('§35 AI failure: message preserved → READY_FOR_REVIEW + AI_FAILED trail, zero approvals', async () => {
    await seedDatabase();
    const db = createDb();

    const ingested = await ingestRawEmail(db, {
      fromEmail: 'tenant1@example.com',
      subject: 'Garage door stuck',
      body: 'The garage door is stuck half open and will not close.',
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const workflow = createInboundWorkflow(db, {
      gateway: createAIGateway({ provider: createMockAIProvider({ forceFailure: true }), db }),
      context: createBuildContext(db),
    });
    const outcome = await workflow(ingested.value.communicationId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.value.status).toBe('NEEDS_REVIEW');
    if (outcome.value.status !== 'NEEDS_REVIEW') return;
    expect(outcome.value.reason).toBe('AI_FAILED');

    // Message row survives untouched; trail recorded; nothing approved/sent.
    const [msg] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, ingested.value.communicationId))
      .limit(1);
    expect(msg?.originalContent).toContain('garage door');

    const failed = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.activityType, 'AI_FAILED'), eq(activities.caseId, outcome.value.caseId)));
    expect(failed.length).toBeGreaterThanOrEqual(1);

    const audits = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'workflow.ai_failed_fallback'));
    expect(audits.length).toBeGreaterThanOrEqual(1);

    // No approval was ever created on the holding case.
    const caseApprovals = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(eq(approvals.caseId, outcome.value.caseId));
    expect(caseApprovals.length).toBe(0);

    await getPool(db).end();
  });

  it('§36 duplicate raw email: same identity twice → one Communication, second is a no-op', async () => {
    await seedDatabase();
    const db = createDb();

    const raw = {
      fromEmail: 'tenant1@example.com',
      subject: 'Oven light not working',
      body: 'The oven light bulb needs replacing.',
      externalMessageId: 'msg-dedupe-001',
    };
    const first = await ingestRawEmail(db, raw);
    const second = await ingestRawEmail(db, raw);

    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(second.ok && first.ok ? second.value.communicationId : '').toBe(
      first.ok ? first.value.communicationId : '',
    );

    const rows = await db
      .select({ id: communications.id })
      .from(communications)
      .where(eq(communications.externalMessageId, 'msg-dedupe-001'));
    expect(rows.length).toBe(1);
    await getPool(db).end();
  });

  it('§37 duplicate send: replaying the same executionKey never sends twice', async () => {
    await seedDatabase();
    const db = createDb();

    // Full chain to a pending approval via the raw-email path.
    const ingested = await ingestRawEmail(db, {
      fromEmail: 'tenant1@example.com',
      subject: 'Dishwasher not working',
      body: 'The dishwasher is broken and not working, please arrange a repair.',
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const inbound = createInboundWorkflow(db, {
      gateway: createAIGateway({ provider: createMockAIProvider(), db }),
      context: createBuildContext(db),
    });
    const processed = await inbound(ingested.value.communicationId);
    expect(processed.ok && processed.value.status === 'PROCESSED' ? true : false).toBe(true);
    if (!processed.ok || processed.value.status !== 'PROCESSED' || !processed.value.approvalId) return;

    const approvalWorkflow = createApprovalWorkflow(db);
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'ADMIN'))
      .limit(1);
    const approved = await approvalWorkflow.approve({
      approvalId: processed.value.approvalId,
      reviewerId: admin!.id,
    });
    expect(approved.ok).toBe(true);

    // Execute TWICE with the same underlying key.
    const firstRun = await approvalWorkflow.executeApproved({ approvalId: processed.value.approvalId });
    const secondRun = await approvalWorkflow.executeApproved({ approvalId: processed.value.approvalId });

    expect(firstRun.ok).toBe(true);
    expect(secondRun.ok).toBe(true);
    expect(firstRun.ok ? firstRun.value.idempotentReplay : undefined).toBeFalsy();
    expect(secondRun.ok ? secondRun.value.idempotentReplay : undefined).toBe(true);

    // Exactly one outbox row and one executed action — one physical effect.
    const executions = await db
      .select({ id: actionExecutions.id })
      .from(actionExecutions)
      .where(eq(actionExecutions.actionId, processed.value.aiActionId!));
    expect(executions.length).toBe(1);
    await getPool(db).end();
  });
});
