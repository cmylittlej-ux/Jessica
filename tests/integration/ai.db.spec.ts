import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  confidenceBand,
  createAIGateway,
  createBuildContext,
  createMockAIProvider,
  AIError,
  type AICompletionRequest,
  type AIProvider,
} from '../../packages/ai/src/index.ts';
import { auditLogs } from '../../packages/db/src/schema/index.ts';
import { createDb, getPool } from '../../packages/db/src/client.ts';
import { seedDatabase } from '../../packages/db/src/seed/run.ts';
import { err } from '../../packages/shared/src/result.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Provider stub whose payload always fails schema validation (Spec §9). */
function makeAlwaysInvalidProvider(): AIProvider {
  return {
    name: 'always-invalid',
    complete: async <T,>(request: AICompletionRequest<T>) => {
      const parsed = request.schema.safeParse({ definitely: 'not the right shape' });
      if (!parsed.success) {
        return err(new AIError('VALIDATION', 'invalid structured output', undefined, parsed.error.issues));
      }
      return err(new AIError('PROVIDER_FAILURE', 'unexpected valid parse of garbage'));
    },
  };
}

describe.skipIf(!hasDb)('AI Gateway integration (Spec §8–§9)', () => {
  it('classifies a seeded inbound email end-to-end via context builder', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { communications } = await import('../../packages/db/src/schema/index.ts');
      const [message] = await db
        .select()
        .from(communications)
        .where(eq(communications.direction, 'INBOUND'))
        .limit(1);
      expect(message).toBeDefined();
      if (!message) return;

      const context = createBuildContext(db);
      const inputResult = await context.buildClassificationInput(message.id);
      expect(inputResult.ok).toBe(true);
      if (!inputResult.ok) return;
      expect(inputResult.value.subject).toBe(message.subject);

      const gateway = createAIGateway({ provider: createMockAIProvider(), db });
      const result = await gateway.classifyCommunication(inputResult.value);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(confidenceBand(result.value.confidence)).toBeDefined();
      expect(result.value.summaryZh.length).toBeGreaterThan(0);
      expect(result.value.summaryEn.length).toBeGreaterThan(0);
    } finally {
      await getPool(db).end();
    }
  });

  it('validation failure is audited and never executed (Spec §9)', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const gateway = createAIGateway({ provider: makeAlwaysInvalidProvider(), db });
      const result = await gateway.classifyCommunication({
        subject: 'anything',
        content: 'anything at all',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');

      const trail = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'ai.validation_failed'));
      expect(trail.length).toBeGreaterThanOrEqual(1);
      expect(trail[0]?.actorType).toBe('AI');
      expect(trail[0]?.entityId).toBe('CLASSIFY_COMMUNICATION');
    } finally {
      await getPool(db).end();
    }
  });

  it('builds a compact case context with a bounded communication window', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { cases } = await import('../../packages/db/src/schema/index.ts');
      const [anyCase] = await db.select().from(cases).limit(1);
      expect(anyCase).toBeDefined();
      if (!anyCase) return;

      const context = createBuildContext(db);
      const ctxResult = await context.buildCaseContext(anyCase.id);
      expect(ctxResult.ok).toBe(true);
      if (!ctxResult.ok) return;
      expect(ctxResult.value.caseId).toBe(anyCase.id);
      expect(ctxResult.value.recentCommunications.length).toBeLessThanOrEqual(5);
      for (const c of ctxResult.value.recentCommunications) {
        expect(c.excerpt.length).toBeLessThanOrEqual(281); // excerpt cap + ellipsis
      }
    } finally {
      await getPool(db).end();
    }
  });

  it('resolves contacts by exact email (TIER_0, zero tokens)', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const { contacts } = await import('../../packages/db/src/schema/index.ts');
      const all = await db.select().from(contacts).limit(50);
      const withEmail = all.find((c) => c.email !== null);
      expect(withEmail).toBeDefined();
      if (!withEmail?.email) return;

      const context = createBuildContext(db);
      const hit = await context.findContactByEmail(withEmail.email);
      expect(hit.ok && hit.value?.id).toBe(withEmail.id);

      const miss = await context.findContactByEmail('nobody@nowhere.test');
      expect(miss.ok && miss.value).toBeNull();
    } finally {
      await getPool(db).end();
    }
  });

  it('summarises and drafts replies through the gateway', async () => {
    await seedDatabase();
    const db = createDb();
    try {
      const context = createBuildContext(db);
      const gateway = createAIGateway({ provider: createMockAIProvider(), db });

      const { cases } = await import('../../packages/db/src/schema/index.ts');
      const [anyCase] = await db.select().from(cases).limit(1);
      if (!anyCase) return;
      const caseContext = await context.buildCaseContext(anyCase.id);
      expect(caseContext.ok).toBe(true);

      const summary = await gateway.summariseCase(
        caseContext.ok ? caseContext.value : { ...anyCase, caseId: anyCase.id, title: anyCase.title },
      );
      expect(summary.ok && summary.value.summaryZh.length > 0).toBe(true);

      const reply = await gateway.generateReply({
        caseContext: caseContext.ok
          ? caseContext.value
          : { caseId: anyCase.id, title: anyCase.title, businessDomain: anyCase.businessDomain, caseType: anyCase.caseType, status: anyCase.status },
        originalMessage: { subject: 'Dishwasher not working', content: 'Please help.' },
      });
      expect(reply.ok && reply.ok && reply.value.bodyZh.includes('感谢')).toBe(true);

      const translation = await gateway.translate({
        text: 'The plumber arrives on Tuesday.',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
      });
      expect(translation.ok && translation.value.translatedText.startsWith('[中译]')).toBe(true);
    } finally {
      await getPool(db).end();
    }
  });
});
