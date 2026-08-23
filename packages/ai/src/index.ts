/**
 * @reos/ai
 *
 * Model-independent AI layer (Spec §2.4, §8-13). Phase 3 delivers:
 *   gateway/    AIGateway interface — the ONLY entry point for business code
 *   providers/  MockAIProvider first; real providers are swappable later
 *   schemas/    Zod schemas validating every structured AI response
 *   context/    Context Builder — token-efficient, task-scoped input assembly
 *   cost/       model tier abstraction (TIER_0..TIER_3)
 */
export const PACKAGE_NAME = '@reos/ai';
