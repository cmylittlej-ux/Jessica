/**
 * @reos/ai — AI Gateway (Spec §8–§12).
 *
 * Business code calls ONLY the gateway; UI and workflows never touch a
 * provider. All structured outputs are Zod-validated (Spec §9), confidence
 * follows the §10 policy, tasks map to model tiers via §11, and context is
 * assembled deterministically per §12 before anything reaches a provider.
 */

export { createAIGateway, type AIGateway, type AIGatewayOptions } from './gateway.ts';
export { createMockAIProvider, type AIProvider, type AICompletionRequest, type MockAIProviderOptions } from './provider.ts';
export { createBuildContext, type ContextMatcher } from './context.ts';
export { AIError, isAIError, type AIErrorCode } from './errors.ts';
export {
  confidenceBand,
  mayAutoEstablishRelationship,
  HIGH_CONFIDENCE_THRESHOLD,
  MANUAL_THRESHOLD,
  type ConfidenceBand,
} from './confidence.ts';
export {
  tierForTask,
  TASK_TIERS,
  type AiTask,
  type ModelTier,
  type DeterministicOp,
} from './tiers.ts';
export * from './schemas.ts';
