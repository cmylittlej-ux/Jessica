import { actionRequiredEnum, businessDomainEnum, caseTypeEnum, priorityEnum } from '@reos/db';
import { z } from 'zod';

/**
 * Structured Output contracts (Spec §9). Every AI response is validated
 * against these schemas before any business code sees it — key business
 * fields are never re-parsed from natural language.
 */

const enumOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values);

export const recommendedActionTypeSchema = z.enum([
  'REPLY_TENANT',
  'REPLY_BUYER',
  'REPLY_OWNER',
  'ESCALATE_URGENT',
  'CREATE_FOLLOW_UP',
  'SCHEDULE_TRADESPERSON',
  'REQUEST_MORE_INFO',
  'BOOK_INSPECTION',
  'NO_ACTION',
]);

export const classificationResultSchema = z.object({
  businessDomain: enumOf(businessDomainEnum.enumValues),
  caseType: enumOf(caseTypeEnum.enumValues),
  priority: enumOf(priorityEnum.enumValues),
  actionRequired: enumOf(actionRequiredEnum.enumValues),
  propertyId: z.string().nullable(),
  contactId: z.string().nullable(),
  summaryZh: z.string().min(1),
  summaryEn: z.string().min(1),
  recommendedActions: z
    .array(
      z.object({
        type: recommendedActionTypeSchema,
        reason: z.string().min(1),
      }),
    )
    .max(5),
  /** 0..1 — policy bands in confidence.ts decide automation rights. */
  confidence: z.number().min(0).max(1),
});
export type ClassificationResult = z.infer<typeof classificationResultSchema>;

export const caseSummarySchema = z.object({
  summaryZh: z.string().min(1),
  summaryEn: z.string().min(1),
  keyPoints: z.array(z.string()).max(8),
  confidence: z.number().min(0).max(1),
});
export type CaseSummary = z.infer<typeof caseSummarySchema>;

export const actionRecommendationSchema = z.object({
  type: recommendedActionTypeSchema,
  reason: z.string().min(1),
});
export const actionRecommendationsSchema = z
  .array(actionRecommendationSchema)
  .max(5);
export type ActionRecommendation = z.infer<typeof actionRecommendationSchema>;

export const generatedReplySchema = z.object({
  subject: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyZh: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type GeneratedReply = z.infer<typeof generatedReplySchema>;

export const translationResultSchema = z.object({
  translatedText: z.string().min(1),
  sourceLanguage: z.string().min(2),
  targetLanguage: z.string().min(2),
  confidence: z.number().min(0).max(1),
});
export type TranslationResult = z.infer<typeof translationResultSchema>;

// --- Inputs (plain data supplied by the caller via Context Builder) ----------

export interface ClassificationInput {
  subject: string;
  content: string;
  language?: string;
  /** Compact candidate lists produced by deterministic matching (§12). */
  candidateProperties?: Array<{ id: string; addressLine1: string; suburb: string }>;
  candidateContacts?: Array<{ id: string; displayName: string; email: string | null }>;
}

export interface CaseContext {
  caseId: string;
  title: string;
  businessDomain: string;
  caseType: string;
  status: string;
  priority?: string;
  recentCommunications?: Array<{
    id: string;
    direction: string;
    subject: string | null;
    excerpt: string;
  }>;
  openTaskCount?: number;
}

export interface ReplyInput {
  caseContext: CaseContext;
  originalMessage?: { subject: string | null; content: string };
  replyLanguage?: 'en' | 'zh';
}

export interface TranslationInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: 'en' | 'zh';
}
