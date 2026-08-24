import { eq } from 'drizzle-orm';
import { createAIGateway, createBuildContext, createMockAIProvider } from '../../packages/ai/src/index.ts';
import {
  createApprovalWorkflow,
  createInboundWorkflow,
  ingestRawEmail,
} from '../../packages/workflows/src/index.ts';
import { cases, users } from '../../packages/db/src/schema/index.ts';
import { createDb } from '../../packages/db/src/client.ts';

/** Shared DB-backed integration helpers (real Postgres required). */

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function adminId(db: Db): Promise<string> {
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
export async function runChain(
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
  await approvalWorkflow.approve({
    approvalId: processed.value.approvalId,
    reviewerId: await adminId(db),
  });
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
