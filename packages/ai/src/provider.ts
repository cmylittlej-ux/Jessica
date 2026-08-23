import { ok, err, type Result } from '@reos/shared';
import type { z } from 'zod';
import { AIError } from './errors.ts';
import type { AiTask, ModelTier } from './tiers.ts';

/**
 * Provider abstraction (Spec §8/§11). The Gateway is the only consumer;
 * UI and workflows must never call a provider directly.
 *
 * The provider receives the Zod schema for its own output and MUST return a
 * payload that satisfies it — the gateway re-validates regardless (trust but
 * verify), so a misbehaving provider can never inject malformed business data.
 */

export interface AICompletionRequest<T> {
  task: AiTask;
  tier: ModelTier;
  systemPrompt: string;
  input: unknown;
  schema: z.ZodType<T>;
}

export interface AIProvider {
  readonly name: string;
  complete<T>(request: AICompletionRequest<T>): Promise<Result<T, AIError>>;
}

// ---------------------------------------------------------------------------
// MockAIProvider — deterministic keyword heuristics, zero network calls
// ---------------------------------------------------------------------------

const MAINTENANCE = [
  'leak', 'burst', 'broken', 'not working', 'repair', 'hot water',
  'blocked', 'dishwasher', 'aircon', 'heating', 'mould', 'mold', 'power outage',
];
const RENT = ['rent', 'payment', 'overdue', 'arrears', 'invoice', 'receipt'];
const INSPECTION = ['inspection', 'open home', 'viewing'];
const LEASE = ['lease', 'renew', 'vacate', 'notice of intention', 'bond'];
const SALES = [
  'offer', 'negotiat', 'settlement', 'buyer', 'vendor', 'contract of sale',
  'deposit', 'auction', 'listing',
];
const SPAM = ['unsubscribe', 'lottery', 'winner', 'crypto', 'viagra', 'seo services'];

function countMatches(text: string, words: readonly string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
}

export interface MockAIProviderOptions {
  /**
   * Force every confidence score to a fixed value — used by tests and by the
   * mandatory Low-Confidence E2E scenario (Spec §34) to exercise human fallback.
   */
  fixedConfidence?: number;
}

export function createMockAIProvider(options: MockAIProviderOptions = {}): AIProvider & {
  calls: Array<{ task: AiTask; tier: ModelTier }>;
} {
  const calls: Array<{ task: AiTask; tier: ModelTier }> = [];

  const classify = (input: { subject: string; content: string }) => {
    const text = `${input.subject}\n${input.content}`;
    if (countMatches(text, SPAM) >= 1) {
      return {
        businessDomain: 'ADMINISTRATION' as const,
        caseType: 'SPAM' as const,
        priority: 'LOW' as const,
        actionRequired: 'NO_ACTION' as const,
      };
    }
    const maintenanceHits = countMatches(text, MAINTENANCE);
    if (maintenanceHits >= 1) {
      return {
        businessDomain: 'PROPERTY_MANAGEMENT' as const,
        caseType: 'MAINTENANCE' as const,
        priority: maintenanceHits >= 2 ? ('HIGH' as const) : ('NORMAL' as const),
        actionRequired: 'REPLY_REQUIRED' as const,
      };
    }
    if (countMatches(text, RENT) >= 1) {
      return {
        businessDomain: 'PROPERTY_MANAGEMENT' as const,
        caseType: 'RENT' as const,
        priority: 'NORMAL' as const,
        actionRequired: 'FOLLOW_UP_REQUIRED' as const,
      };
    }
    if (countMatches(text, INSPECTION) >= 1) {
      return {
        businessDomain: 'PROPERTY_MANAGEMENT' as const,
        caseType: 'INSPECTION' as const,
        priority: 'NORMAL' as const,
        actionRequired: 'INFORMATION_ONLY' as const,
      };
    }
    if (countMatches(text, LEASE) >= 1) {
      return {
        businessDomain: 'PROPERTY_MANAGEMENT' as const,
        caseType: 'LEASE_RENEWAL' as const,
        priority: 'NORMAL' as const,
        actionRequired: 'DECISION_REQUIRED' as const,
      };
    }
    if (countMatches(text, SALES) >= 1) {
      return {
        businessDomain: 'SALES' as const,
        caseType: 'BUYER_ENQUIRY' as const,
        priority: 'NORMAL' as const,
        actionRequired: 'REPLY_REQUIRED' as const,
      };
    }
    return null;
  };

  /** Strong keyword hit = high confidence; weak = review; none = manual. */
  const confidenceFor = (hits: number): number => {
    if (options.fixedConfidence !== undefined) return options.fixedConfidence;
    if (hits >= 2) return 0.96;
    if (hits === 1) return 0.82;
    return 0.55;
  };

  return {
    name: 'mock',
    calls,

    async complete<T>(request: AICompletionRequest<T>): Promise<Result<T, AIError>> {
      calls.push({ task: request.task, tier: request.tier });

      let candidate: unknown;
      try {
        switch (request.task) {
          case 'CLASSIFY_COMMUNICATION': {
            const input = request.input as { subject: string; content: string };
            const text = `${input.subject}\n${input.content}`;
            const matched =
              countMatches(text, MAINTENANCE) +
              countMatches(text, RENT) +
              countMatches(text, INSPECTION) +
              countMatches(text, LEASE) +
              countMatches(text, SALES) +
              countMatches(text, SPAM);
            const base = classify(input);
            candidate = {
              businessDomain: base?.businessDomain ?? 'UNKNOWN',
              caseType: base?.caseType ?? 'OTHER_ADMIN',
              priority: base?.priority ?? 'NORMAL',
              actionRequired: base?.actionRequired ?? 'WAITING_FOR_OTHER',
              propertyId: null,
              contactId: null,
              summaryZh: `邮件「${input.subject}」已分类为 ${base?.caseType ?? '其他'}。`,
              summaryEn: `Email "${input.subject}" classified as ${base?.caseType ?? 'other'}.`,
              recommendedActions:
                base?.actionRequired === 'REPLY_REQUIRED'
                  ? [{ type: 'REQUEST_MORE_INFO', reason: 'Acknowledge and ask for details or photos.' }]
                  : [{ type: 'NO_ACTION', reason: 'No immediate action required.' }],
              confidence: confidenceFor(matched),
            };
            break;
          }
          case 'SUMMARISE_CASE': {
            const ctx = request.input as {
              title: string;
              status: string;
              recentCount: number;
            };
            candidate = {
              summaryZh: `${ctx.title}（${ctx.status}）：近期共 ${ctx.recentCount} 条相关通信。`,
              summaryEn: `${ctx.title} (${ctx.status}): ${ctx.recentCount} recent communications.`,
              keyPoints: [`${ctx.recentCount} communications on record`, `Status is ${ctx.status}`],
              confidence: options.fixedConfidence ?? 0.9,
            };
            break;
          }
          case 'RECOMMEND_ACTIONS': {
            const ctx = request.input as { caseType: string; priority?: string };
            candidate =
              ctx.caseType === 'MAINTENANCE'
                ? [
                    { type: 'SCHEDULE_TRADESPERSON', reason: 'Maintenance issues need a trade inspection.' },
                    { type: 'CREATE_FOLLOW_UP', reason: 'Confirm resolution with the tenant afterwards.' },
                  ]
                : [{ type: 'REQUEST_MORE_INFO', reason: 'Gather more context before acting.' }];
            break;
          }
          case 'GENERATE_REPLY': {
            const input = request.input as {
              originalSubject?: string | null;
              replyLanguage?: string;
            };
            candidate = {
              subject: `Re: ${input.originalSubject ?? 'your enquiry'}`,
              bodyEn:
                'Thank you for your email. We have logged your request and will update you within one business day.\n\nKind regards,\nBayside Property',
              bodyZh:
                '感谢您的来信。我们已记录您的请求，并将在一个工作日内向您更新进展。\n\n此致\nBayside Property',
              confidence: options.fixedConfidence ?? 0.93,
            };
            void input.replyLanguage;
            break;
          }
          case 'TRANSLATE': {
            const input = request.input as {
              text: string;
              sourceLanguage: string;
              targetLanguage: string;
            };
            // Mock "translation": deterministic wrapper, no machine translation.
            candidate = {
              translatedText:
                input.targetLanguage === 'zh' ? `[中译] ${input.text}` : `[EN] ${input.text}`,
              sourceLanguage: input.sourceLanguage,
              targetLanguage: input.targetLanguage,
              confidence: options.fixedConfidence ?? 0.9,
            };
            break;
          }
        }
      } catch (cause) {
        return err(
          new AIError(
            'PROVIDER_FAILURE',
            `mock provider crashed during ${request.task}`,
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }

      // The mock holds itself to the same contract a real provider must meet.
      const parsed = request.schema.safeParse(candidate);
      if (!parsed.success) {
        return err(
          new AIError(
            'VALIDATION',
            `mock provider produced invalid output for ${request.task}`,
            undefined,
            parsed.error.issues,
          ),
        );
      }
      return ok(parsed.data);
    },
  };
}
