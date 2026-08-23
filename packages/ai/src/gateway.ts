import { auditLogs, type ReosDatabase } from '@reos/db';
import { ok, err, type Result } from '@reos/shared';
import type { ZodType, z } from 'zod';
import type { AIError } from './errors.ts';
import {
  actionRecommendationsSchema,
  caseSummarySchema,
  classificationResultSchema,
  generatedReplySchema,
  translationResultSchema,
  type ActionRecommendation,
  type CaseContext,
  type ClassificationInput,
  type ClassificationResult,
  type GeneratedReply,
  type ReplyInput,
  type TranslationInput,
  type TranslationResult,
} from './schemas.ts';
import type { AIProvider } from './provider.ts';
import { tierForTask, type AiTask } from './tiers.ts';

/**
 * AIGateway (Spec §8) — the ONLY surface business code may use for AI.
 * UI and workflows are forbidden from touching providers directly.
 *
 * Every response is re-validated against its Zod schema here (Spec §9).
 * Validation failure → do not execute; the gateway appends an AuditLog entry
 * (when a database is wired) so the workflow layer can mark the action
 * AI_FAILED without losing the technical details.
 */

export interface AIGateway {
  classifyCommunication(input: ClassificationInput): Promise<Result<ClassificationResult, AIError>>;
  summariseCase(input: CaseContext): Promise<Result<z.infer<typeof caseSummarySchema>, AIError>>;
  recommendActions(input: CaseContext): Promise<Result<ActionRecommendation[], AIError>>;
  generateReply(input: ReplyInput): Promise<Result<GeneratedReply, AIError>>;
  translate(input: TranslationInput): Promise<Result<TranslationResult, AIError>>;
}

export interface AIGatewayOptions {
  provider: AIProvider;
  /** Optional — enables audit logging of validation failures. */
  db?: ReosDatabase;
  actorId?: string;
}

export function createAIGateway(options: AIGatewayOptions): AIGateway {
  const { provider, db, actorId } = options;

  async function run<T>(
    task: AiTask,
    systemPrompt: string,
    input: unknown,
    schema: ZodType<T>,
  ): Promise<Result<T, AIError>> {
    const result = await provider.complete({ task, tier: tierForTask(task), systemPrompt, input, schema });
    if (result.ok) return ok(result.value);

    // Spec §9: validation failure must be audited, never executed silently.
    if (db) {
      try {
        await db.insert(auditLogs).values({
          id: `aud_${crypto.randomUUID()}`,
          actorType: 'AI',
          actorId,
          action: 'ai.validation_failed',
          entityType: 'AITask',
          entityId: task,
          afterData: {
            provider: provider.name,
            code: result.error.code,
            message: result.error.message,
          },
          metadata: { issues: result.error.issues ?? null },
          createdAt: new Date(),
        });
      } catch {
        // Auditing must never mask the original AI error.
      }
    }
    return err(result.error);
  }

  return {
    async classifyCommunication(input) {
      return run(
        'CLASSIFY_COMMUNICATION',
        'Classify the real estate communication into domain/case type/priority. Respond with structured JSON only.',
        input,
        classificationResultSchema,
      );
    },

    async summariseCase(input) {
      return run(
        'SUMMARISE_CASE',
        'Summarise the case bilingually (zh + en) from only the provided context.',
        input,
        caseSummarySchema,
      );
    },

    async recommendActions(input) {
      return run(
        'RECOMMEND_ACTIONS',
        'Recommend up to 5 next actions for this case. Structured JSON only.',
        input,
        actionRecommendationsSchema,
      );
    },

    async generateReply(input) {
      return run(
        'GENERATE_REPLY',
        'Draft a professional bilingual reply to the original message.',
        input,
        generatedReplySchema,
      );
    },

    async translate(input) {
      return run(
        'TRANSLATE',
        'Translate the text. Preserve meaning exactly; no commentary.',
        input,
        translationResultSchema,
      );
    },
  };
}
