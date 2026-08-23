/**
 * Confidence Policy (Spec §10). Thresholds are policy, not vibes:
 *   >= 0.90            High confidence — may auto-establish relations
 *   0.70 – 0.89        Normal review
 *   < 0.70             Needs manual classification / human fallback
 * The UI must always display confidence (§10), so the band travels with data.
 */

export const HIGH_CONFIDENCE_THRESHOLD = 0.9;
export const MANUAL_THRESHOLD = 0.7;

export type ConfidenceBand =
  | 'HIGH'
  | 'NORMAL_REVIEW'
  | 'NEEDS_MANUAL_CLASSIFICATION';

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'HIGH';
  if (score >= MANUAL_THRESHOLD) return 'NORMAL_REVIEW';
  return 'NEEDS_MANUAL_CLASSIFICATION';
}

/**
 * Low-confidence AI output must never automatically create high-risk business
 * relationships (new owner/tenant/lease links, offers, payments).
 */
export function mayAutoEstablishRelationship(score: number): boolean {
  return score >= HIGH_CONFIDENCE_THRESHOLD;
}
