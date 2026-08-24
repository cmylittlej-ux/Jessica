import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  completeFollowUpTask,
  createApprovalWorkflow,
  ensureCaseWakeUp,
} from '../../packages/workflows/src/index.ts';
import { actionExecutions, cases, communications, tasks } from '../../packages/db/src/schema/index.ts';
import { createDb } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';
import { adminId, runChain } from './helpers.ts';

/**
 * Phase 2 Gate 2.0 — Final Integration Safety Patch evidence (Spec §3).
 *
 * A1: a stale EXECUTING lock is never blindly resent — it reconciles against
 *     the durable idempotency-key evidence first.
 * A2: every WAITING case has a future wake-up; the helper is idempotent.
 * A3: OPEN / IN_PROGRESS / WAITING tasks block case completion.
 */

describe.skipIf(!process.env.DATABASE_URL)('Phase 2 Gate 2.0 — A1 uncertain external effect', () => {
  it('A1-M — crash after send, before finalize: retry reconciles to EXECUTED and never sends twice', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    // Chain approved but NOT executed — we simulate the crash manually.
    const { approvalId, actionId } = await runChain(
      db,
      `Dishwasher crash-after-send ${Date.now().toString(36)}`,
      undefined,
    );

    // Crash simulation part 1: lock left EXECUTING long ago (stale).
    const executionKey = `exec:${approvalId}:${actionId}`;
    await db.insert(actionExecutions).values({
      id: `aex_${crypto.randomUUID()}`,
      actionId,
      executionKey,
      status: 'EXECUTING',
      attempts: 1,
      claimedAt: new Date(Date.now() - 120_000),
      correlationId: null,
      createdAt: new Date(Date.now() - 120_000),
    });

    // Crash simulation part 2: the connector effect SUCCEEDED (the provider
    // accepted and recorded the send) but local finalize never ran.
    const ghostCommId = `comm_ghost_${Date.now().toString(36)}`;
    await db.insert(communications).values({
      id: ghostCommId,
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      senderType: 'USER',
      subject: 'ghost send — finalize never ran',
      originalContent: 'this message exists at the provider but was never finalized locally',
      originalLanguage: 'en',
      status: 'SENT',
      sentAt: new Date(),
      createdAt: new Date(),
      source: 'MANUAL',
      idempotencyKey: executionKey,
    });
    const outboundBefore = (
      await db
        .select({ id: communications.id })
        .from(communications)
        .where(eq(communications.idempotencyKey, executionKey))
    ).length;
    expect(outboundBefore).toBe(1);

    // Retry after the crash.
    const workflow = createApprovalWorkflow(db);
    const result = await workflow.executeApproved({ approvalId, actorId: await adminId(db) });
    expect(result.ok).toBe(true);

    // The ghost receipt must be adopted — NOT re-sent.
    expect(result.ok ? result.value.communicationId : null).toBe(ghostCommId);
    expect(result.ok ? result.value.idempotentReplay : null).toBe(true);

    const [row] = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.executionKey, executionKey))
      .limit(1);
    expect(row?.status).toBe('EXECUTED');
    expect(row?.externalRef).toBe(ghostCommId);

    // Exactly ONE outbound communication for this execution — no duplicate send.
    const outboundAfter = (
      await db
        .select({ id: communications.id })
        .from(communications)
        .where(eq(communications.idempotencyKey, executionKey))
    ).length;
    expect(outboundAfter).toBe(1);
  });

  it('A1-R — stale EXECUTING with NO evidence: provably not sent ⇒ safe retry completes once', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    const { approvalId, actionId, workflow } = await runChain(
      db,
      `Dishwasher stale-no-evidence ${Date.now().toString(36)}`,
      undefined,
    );

    // Crash BEFORE the connector ran — no outbound communication exists.
    const executionKey = `exec:${approvalId}:${actionId}`;
    await db.insert(actionExecutions).values({
      id: `aex_${crypto.randomUUID()}`,
      actionId,
      executionKey,
      status: 'EXECUTING',
      attempts: 1,
      claimedAt: new Date(Date.now() - 120_000),
      correlationId: null,
      createdAt: new Date(Date.now() - 120_000),
    });

    const result = await workflow.executeApproved({ approvalId, actorId: await adminId(db) });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.executionKey, executionKey));
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('EXECUTED');

    const sent = (
      await db
        .select({ id: communications.id })
        .from(communications)
        .where(eq(communications.idempotencyKey, executionKey))
    ).length;
    expect(sent).toBe(1); // exactly one real send
  });
});

describe.skipIf(!process.env.DATABASE_URL)('Phase 2 Gate 2.0 — A2 WAITING wake-up invariant', () => {
  it('A2-1 — send lands WAITING even with no pre-existing task ⇒ wake-up auto-created', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    const chain = await runChain(db, `Dishwasher wake-up chain ${Date.now().toString(36)}`, undefined, {
      execute: true,
    });
    expect(chain.caseId).toBeTruthy();

    const [afterSend] = await db.select().from(cases).where(eq(cases.id, chain.caseId!)).limit(1);
    expect(afterSend?.status).toBe('WAITING');

    const blocking = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.caseId, chain.caseId!), eq(tasks.status, 'OPEN')));
    expect(blocking.length).toBeGreaterThanOrEqual(1); // invariant holds
  });

  it('A2-2 — no task at all before send ⇒ executeApproved creates exactly one wake-up', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    // Approve, then strip ALL tasks so nothing blocks the invariant.
    const { caseId, approvalId } = await runChain(
      db,
      `Dishwasher orphan-waiting ${Date.now().toString(36)}`,
      undefined,
    );
    await db.delete(tasks).where(eq(tasks.caseId, caseId!));

    const workflow = createApprovalWorkflow(db);
    const executed = await workflow.executeApproved({ approvalId, actorId: await adminId(db) });
    expect(executed.ok).toBe(true);

    const [afterSend] = await db.select().from(cases).where(eq(cases.id, caseId!)).limit(1);
    expect(afterSend?.status).toBe('WAITING');

    const wakeUps = await db
      .select({ id: tasks.id, source: tasks.source })
      .from(tasks)
      .where(and(eq(tasks.caseId, caseId!), eq(tasks.status, 'OPEN')));
    expect(wakeUps.length).toBe(1);
    expect(wakeUps[0]?.source).toBe('WORKFLOW');
    const [created] = await db.select().from(tasks).where(eq(tasks.caseId, caseId!)).limit(1);
    expect(created?.dueAt).toBeTruthy(); // future wake-up guaranteed
  });

  it('A2-3 — ensureCaseWakeUp is idempotent (double call ⇒ one task)', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    const { caseId } = await runChain(db, `Dishwasher idem wake-up ${Date.now().toString(36)}`, undefined, {
      execute: true,
    });
    await db.delete(tasks).where(eq(tasks.caseId, caseId!));

    const first = await ensureCaseWakeUp(db, caseId!);
    expect(first.created).toBe(true);
    const second = await ensureCaseWakeUp(db, caseId!);
    expect(second.created).toBe(false);
    expect(second.reason).toBe('WAKE_UP_EXISTS');

    const count = (
      await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.caseId, caseId!))
    ).length;
    expect(count).toBe(1);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('Phase 2 Gate 2.0 — A3 blocking-task closure', () => {
  for (const blockingStatus of ['OPEN', 'IN_PROGRESS', 'WAITING'] as const) {
    it(`A3 — a ${blockingStatus} sibling task keeps the case open`, async () => {
      const db = (await import('../../packages/db/src/client.ts')).createDb();
      await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

      const { caseId, taskId } = await runChain(
        db,
        `Dishwasher blocking ${blockingStatus.toLowerCase()} ${Date.now().toString(36)}`,
        undefined,
      );
      expect(taskId).toBeTruthy();

      await db.insert(tasks).values({
        id: `tsk_blk_${blockingStatus.toLowerCase()}_${Date.now().toString(36)}`,
        caseId,
        assignedUserId: await adminId(db),
        title: `Sibling blocker (${blockingStatus})`,
        status: blockingStatus,
        source: 'HUMAN',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await completeFollowUpTask(db, taskId!);
      expect(result.taskDone).toBe(true);
      expect(result.remainingOpenTasks).toBe(1);
      expect(result.caseCompleted).toBe(false);

      const [stillOpen] = await db.select().from(cases).where(eq(cases.id, caseId!)).limit(1);
      expect(stillOpen?.status).not.toBe('COMPLETED');
    });
  }

  it('A3 — DONE/CANCELLED siblings do not block completion', async () => {
    const db = (await import('../../packages/db/src/client.ts')).createDb();
    await (await import('../../packages/db/src/seed/run.ts')).seedDatabase();

    const { caseId, taskId } = await runChain(db, `Dishwasher terminal sibs ${Date.now().toString(36)}`);
    for (const [i, status] of ['DONE', 'CANCELLED'].entries()) {
      await db.insert(tasks).values({
        id: `tsk_term_${i}_${Date.now().toString(36)}`,
        caseId,
        assignedUserId: await adminId(db),
        title: `Terminal sibling (${status})`,
        status,
        source: 'HUMAN',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const result = await completeFollowUpTask(db, taskId!);
    expect(result.caseCompleted).toBe(true);
  });
});
