/**
 * Confidence policy (Spec §10 / Hardening §3, §4).
 *
 * Bands decide automation rights. The SAME bands apply to AI classification
 * confidence and to Case Match confidence — but the two scores are computed
 * independently and BOTH gates must pass before any automatic relation is
 * created. There is no path that bypasses a low-confidence hold.
 */

export const AUTO_LINK_THRESHOLD = 0.9;
export const REVIEW_THRESHOLD = 0.7;

export type ConfidenceBand = 'AUTO' | 'REVIEW' | 'NEEDS_MANUAL_CLASSIFICATION';

/** ≥ 0.90 auto · 0.70–0.89 suggest + review · < 0.70 manual only. */
export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= AUTO_LINK_THRESHOLD) return 'AUTO';
  if (confidence >= REVIEW_THRESHOLD) return 'REVIEW';
  return 'NEEDS_MANUAL_CLASSIFICATION';
}

/**
 * Hardening §3: automation requires BOTH gates. A high match confidence can
 * never rescue a low classification confidence and vice versa.
 */
export function automationAllowed(
  classificationConfidence: number,
  matchConfidence: number | null,
): boolean {
  if (bandOf(classificationConfidence) !== 'AUTO') return false;
  // When no case link decision exists yet (new case), matching does not gate.
  if (matchConfidence === null || matchConfidence === undefined) return true;
  return bandOf(matchConfidence) !== 'NEEDS_MANUAL_CLASSIFICATION';
}
