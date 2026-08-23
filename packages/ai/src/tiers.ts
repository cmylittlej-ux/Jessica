/**
 * Model Router foundations (Spec §11). The business layer only ever sees
 * task names and tiers — never concrete model identifiers.
 */

export type ModelTier = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';

/** Task names mirror ai_action_type values so AIAction rows can reference them. */
export type AiTask =
  | 'CLASSIFY_COMMUNICATION'
  | 'SUMMARISE_CASE'
  | 'RECOMMEND_ACTIONS'
  | 'GENERATE_REPLY'
  | 'TRANSLATE';

/**
 * Tier assignment follows Spec §11 examples: translation is economy work,
 * classification / drafting / summarising standard reasoning.
 */
export const TASK_TIERS: Record<AiTask, ModelTier> = {
  CLASSIFY_COMMUNICATION: 'TIER_2',
  SUMMARISE_CASE: 'TIER_2',
  RECOMMEND_ACTIONS: 'TIER_2',
  GENERATE_REPLY: 'TIER_2',
  TRANSLATE: 'TIER_1',
};

export function tierForTask(task: AiTask): ModelTier {
  return TASK_TIERS[task];
}

/**
 * Deterministic operations that must NEVER reach an AI provider (Spec §12).
 * Business code resolves these with plain code — AI token cost = 0.
 */
export type DeterministicOp =
  | 'EXACT_ADDRESS_LOOKUP'
  | 'CONTACT_EXACT_EMAIL_MATCH'
  | 'DATE_CALCULATION'
  | 'LEASE_EXPIRY_CALCULATION'
  | 'TASK_TIMER'
  | 'STATUS_CHANGE'
  | 'KNOWN_TEMPLATE'
  | 'SIMPLE_FIELD_VALIDATION';
