import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAIGateway, createBuildContext, createMockAIProvider } from '../../packages/ai/src/index.ts';
import {
  completeFollowUpTask,
  createApprovalWorkflow,
  createInboundWorkflow,
  ingestRawEmail,
  processDueFollowUps,
} from '../../packages/workflows/src/index.ts';
import {
  actionExecutions,
  aiActions,
  approvals,
  cases,
  communications,
  tasks,
  users,
} from '../../packages/db/src/schema/index.ts';
import { createDb, getPool } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/**
 * Final P0 Closure evidence (Spec §1–§5). Every external-effect guarantee
 * needed before a real Outlook / PropertyMe connector may be attempted.
 */

type Db = Awaited<ReturnType<typeof createDb>>;

async function adminId(db: Db): Promise<string> {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'ADMIN')).limit(1);
  if (!admin) throw new Error('no admin user');
  return admin.id;
}

/**
 * Full ingest → process → approve chain.
 *
 * Subjects deliberately carry strong "dishwasher" tokens so the Case Matcher
 * deterministically AUTO-links to seeded cas_901 (≥0.90) instead of landing in
 * the 0.70–0.89 REVIEW band — matching must never be a source of flake here.
 *
 * `execute: true` also runs executeApproved (the reply-send step), which is
 * what §1 closure semantics are defined against ("send → WAITING").
 */
async function runChain(
  db: Db,
  subject: string,
  conversationId?: string,
  opts: { execute?: boolean } = {},
) {
  const ingested = await ingestRawEmail(db, {
    fromEmail: 'tenant1@example.com',
    subject,
    body: 'The dishwasher is broken and not working, please arrange a repair.',
    externalConversationId: conversationId,
  });
  if (!ingested.ok) throw new Error('ingest failed');
  const inbound = createInboundWorkflow(db, {
    gateway: createAIGateway({ provider: createMockAIProvider(), db }),
    context: createBuildContext(db),
  });
  const processed = await inbound(ingested.value.communicationId);
  if (!processed.ok || processed.value.status !== 'PROCESSED' || !processed.value.approvalId) {
    throw new Error(`workflow did not reach approval: ${JSON.stringify(processed)}`);
  }
  const approvalWorkflow = createApprovalWorkflow(db);
  await approvalWorkflow.approve({ approvalId: processed.value.approvalId, reviewerId: await adminId(db) });
  if (opts.execute) {
    const executed = await approvalWorkflow.executeApproved({
      approvalId: processed.value.approvalId,
      actorId: await adminId(db),
    });
    if (!executed.ok) {
      throw new Error(`executeApproved failed: ${JSON.stringify(executed)}`);
    }
  }
  return {
    communicationId: ingested.value.communicationId,
    caseId: processed.value.caseId,
    taskId: processed.value.taskIds[0] ?? null,
    approvalId: processed.value.approvalId,
    actionId: processed.value.aiActionId!,
    workflow: approvalWorkflow,
  };
}

describe.skipIf(!hasDb)('P0-1 — Case/Task workflow closure (§1)', () => {
  it('send → WAITING; due follow-up → FOLLOW_UP_DUE; final completion → COMPLETED', async () => {
    await seedDatabase();
    const db = createDb();

    // P0-1: SEND lands the case in WAITING with a follow-up task.
    const { caseId, taskId } = await runChain(db, 'Dishwasher repair follow-up chain', undefined, {
      execute: true,
    });
    expect(caseId).toBeTruthy();
    const [afterSend] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    expect(afterSend?.status).toBe('WAITING');
    expect(taskId).toBeTruthy();

    // P0-2: dueAt in the past + processDueFollowUps ⇒ FOLLOW_UP_DUE.
    await db
      .update(tasks)
      .set({ dueAt: new Date(Date.now() - 3600_000) })
      .where(eq(tasks.id, taskId!));
    const advanced = await processDueFollowUps(db, new Date());
    expect(advanced.advancedCaseIds).toContain(caseId);
    const [afterDue] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    expect(afterDue?.status).toBe('FOLLOW_UP_DUE');

    // P0-3: completing the final required follow-up closes the case.
    const done = await completeFollowUpTask(db, taskId!);
    expect(done.taskDone).toBe(true);
    expect(done.caseCompleted).toBe(true);
    const [completed] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    expect(completed?.status).toBe('COMPLETED');
    await getPool(db).end();
  });

  it('P0-4 — remaining blocking task keeps the case open', async () => {
    await seedDatabase();
    const db = createDb();
    const { caseId, taskId } = await runChain(db, 'Second dishwasher chain');
    expect(taskId).toBeTruthy();

    await db.insert(tasks).values({
      id: `tsk_block_${Date.now().toString(36)}`,
      caseId,
      assignedUserId: await adminId(db),
      title: 'Extra blocking work',
      status: 'OPEN',
      source: 'HUMAN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await completeFollowUpTask(db, taskId!);
    expect(result.taskDone).toBe(true);
    expect(result.remainingOpenTasks).toBe(1);
    expect(result.caseCompleted).toBe(false);

    const [stillOpen] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    expect(stillOpen?.status).not.toBe('COMPLETED');
    await getPool(db).end();
  });
});

describe.skipIf(!hasDb)('P0-3 — Outbox concurrency & crash recovery (§3)', () => {
  /** Pre-insert an EXECUTING claim row exactly as a live/crashed worker would leave it. */
  async function seedExecutingRow(
    db: Db,
    actionId: string,
    approvalId: string,
    claimedAt: Date,
  ) {
    await db.insert(actionExecutions).values({
      id: `aex_${crypto.randomUUID()}`,
      actionId,
      executionKey: `exec:${approvalId}:${actionId}`,
      status: 'EXECUTING',
      attempts: 1,
      claimedAt,
      correlationId: null,
      createdAt: claimedAt,
    });
  }

  it('P0-7 — two concurrent executeApproved calls produce exactly one outbound send', async () => {
    await seedDatabase();
    const db = createDb();
    const { approvalId, actionId, workflow } = await runChain(
      db,
      `Dishwasher concurrent execute ${Date.now().toString(36)}`,
    );

    const results = await Promise.all([
      workflow.executeApproved({ approvalId }),
      workflow.executeApproved({ approvalId }),
    ]);

    const actualSends = results.filter(
      (r): r is Extract<typeof r, { ok: true }> & { value: { communicationId: string } } =>
        r.ok && !r.value.idempotentReplay && r.value.communicationId !== null,
    );
    expect(actualSends.length).toBe(1);

    const executions = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.actionId, actionId));
    expect(executions.length).toBe(1);
    expect(['EXECUTED']).toContain(executions[0]?.status);
    await getPool(db).end();
  });

  it('P0-8 — fresh EXECUTING lock: second caller is a safe no-op, no second send', async () => {
    await seedDatabase();
    const db = createDb();
    const { approvalId, actionId, workflow } = await runChain(
      db,
      `Dishwasher executing lock ${Date.now().toString(36)}`,
    );

    // Simulate another live worker holding the claim right now.
    await seedExecutingRow(db, actionId, approvalId, new Date());

    const blocked = await workflow.executeApproved({ approvalId });
    expect(blocked.ok).toBe(true); // safe no-op, NOT an error
    expect(blocked.ok ? blocked.value.communicationId : null).toBeNull(); // never sent

    const [row] = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.actionId, actionId))
      .limit(1);
    expect(row?.status).toBe('EXECUTING'); // untouched by the second caller
    await getPool(db).end();
  });

  it('P0-9 — crash window: stale EXECUTING is recovered once and never duplicates', async () => {
    await seedDatabase();
    const db = createDb();
    const { approvalId, actionId, workflow } = await runChain(
      db,
      `Dishwasher crash window ${Date.now().toString(36)}`,
    );

    // Crash simulation: connector never ran, lock left EXECUTING long ago.
    await seedExecutingRow(db, actionId, approvalId, new Date(Date.now() - 120_000));

    const recovered = await workflow.executeApproved({ approvalId });
    expect(recovered.ok).toBe(true);

    const rows = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.actionId, actionId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('EXECUTED'); // recovery completed the effect once
    await getPool(db).end();
  });
});

describe.skipIf(!hasDb)('P0-4 — INFORMATION_ONLY early return (§4)', () => {
  it('P0-10 — standalone FYI creates zero Cases/Tasks/Approvals', async () => {
    await seedDatabase();
    const db = createDb();
    const before = (await db.select({ id: cases.id }).from(cases)).length;
    // Seed data already carries PENDING approvals — assert on the DELTA, not
    // on a global zero (Spec §4 requires "no new" effects, not an empty DB).
    const pendingBefore = (
      await db
        .select({ id: approvals.id })
        .from(approvals)
        .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
        .where(eq(approvals.status, 'PENDING'))
    ).length;

    const ingested = await ingestRawEmail(db, {
      fromEmail: 'tenant1@example.com',
      subject: `Routine inspection schedule ${Date.now().toString(36)}`,
      body: 'This is just an informational note about the upcoming routine inspection window.',
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const inbound = createInboundWorkflow(db, {
      gateway: createAIGateway({ provider: createMockAIProvider(), db }),
      context: createBuildContext(db),
    });
    const outcome = await inbound(ingested.value.communicationId);
    expect(outcome.ok ? outcome.value.status : '').toBe('INFORMATION_ONLY');

    const after = (await db.select({ id: cases.id }).from(cases)).length;
    expect(after).toBe(before); // NO case created

    const [comm] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, ingested.value.communicationId))
      .limit(1);
    expect(comm?.caseId ?? null).toBeNull();

    const pendingAfter = (
      await db
        .select({ id: approvals.id })
        .from(approvals)
        .innerJoin(aiActions, eq(aiActions.id, approvals.actionId))
        .where(eq(approvals.status, 'PENDING'))
    ).length;
    expect(pendingAfter).toBe(pendingBefore); // NO approval created
    await getPool(db).end();
  });

  it('P0-11 — information-only reply on an existing thread attaches, no new Case', async () => {
    await seedDatabase();
    const db = createDb();
    const before = (await db.select({ id: cases.id }).from(cases)).length;

    // Establish a maintenance conversation.
    const first = await runChain(db, `Dishwasher thread ${Date.now().toString(36)}`, 'conv-p0-11');

    // A FYI follow-up on the SAME conversation thread.
    const ingested = await ingestRawEmail(db, {
      fromEmail: 'tenant1@example.com',
      subject: 'Also — inspection note',
      body: 'While you are at it, here is an informational note about the inspection schedule.',
      externalConversationId: 'conv-p0-11',
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const inbound = createInboundWorkflow(db, {
      gateway: createAIGateway({ provider: createMockAIProvider(), db }),
      context: createBuildContext(db),
    });
    const outcome = await inbound(ingested.value.communicationId);
    expect(outcome.ok ? outcome.value.status : '').toBe('INFORMATION_ONLY');
    expect(
      outcome.ok && outcome.value.status === 'INFORMATION_ONLY' ? outcome.value.attachedCaseId ?? null : null,
    ).toBe(first.caseId); // attached to the existing case

    const after = (await db.select({ id: cases.id }).from(cases)).length;
    expect(after).toBe(before); // no NEW case created
    await getPool(db).end();
  });
});

describe.skipIf(!hasDb)('P0-5 — Strict Outlook source identity (§5)', () => {
  it('P0-12/P0-13 — OUTLOOK without messageId or accountId fails validation', async () => {
    await seedDatabase();
    const db = createDb();

    const missingMessageId = await ingestRawEmail(db, {
      fromEmail: 'a@b.example',
      subject: 'x',
      body: 'hello',
      source: 'OUTLOOK',
      sourceAccountId: 'mailbox-1',
    });
    expect(missingMessageId.ok).toBe(false);

    const missingAccountId = await ingestRawEmail(db, {
      fromEmail: 'a@b.example',
      subject: 'x',
      body: 'hello',
      source: 'OUTLOOK',
      externalMessageId: 'm-1',
    });
    expect(missingAccountId.ok).toBe(false);
    await getPool(db).end();
  });

  it('P0-14/P0-15 — composite identity: same content ≠ same message; replay dedupes; mailbox scopes identity', async () => {
    await seedDatabase();
    const db = createDb();
    const content = { fromEmail: 'c@d.example', subject: 'Same', body: 'identical body' };

    const one = await ingestRawEmail(db, {
      ...content,
      source: 'OUTLOOK',
      sourceAccountId: 'mb',
      externalMessageId: 'AAMkAAA-1',
    });
    const two = await ingestRawEmail(db, {
      ...content,
      source: 'OUTLOOK',
      sourceAccountId: 'mb',
      externalMessageId: 'AAMkAAA-2',
    });
    expect(one.ok && two.ok).toBe(true);
    expect((two.ok ? two.value.communicationId : '')).not.toBe(one.ok ? one.value.communicationId : '');

    const replay = await ingestRawEmail(db, {
      ...content,
      source: 'OUTLOOK',
      sourceAccountId: 'mb',
      externalMessageId: 'AAMkAAA-1',
    });
    expect(replay.ok && replay.value.duplicate).toBe(true);

    // Different mailbox ⇒ different composite identity ⇒ not a duplicate.
    const otherMailbox = await ingestRawEmail(db, {
      ...content,
      source: 'OUTLOOK',
      sourceAccountId: 'other-mb',
      externalMessageId: 'AAMkAAA-1',
    });
    expect(otherMailbox.ok && otherMailbox.value.duplicate).toBe(false);
    await getPool(db).end();
  });
});
