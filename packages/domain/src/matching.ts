/**
 * Case Matcher policy (Spec Hardening §4, §28).
 *
 * Pure scoring functions — no database access — so they are unit-testable and
 * reusable by the workflow engine. The matcher NEVER merges on
 * property + caseType alone: content evidence must contribute.
 */

/** Weighted evidence factors for case matching. */
export interface CaseMatchEvidence {
  /** Same Outlook conversation / message thread. */
  sameConversation: boolean;
  /** Existing communication already attached to the candidate case. */
  sameCommunicationThread: boolean;
  /** Message is linked to the same external entity (e.g. MaintenanceJob). */
  sameExternalEntity: boolean;
  sameProperty: boolean;
  sameContact: boolean;
  sameCaseType: boolean;
  /** Normalised token overlap between incoming text and case title/subject. */
  subjectSimilarity: number; // 0..1
  contentSimilarity: number; // 0..1
  /** Case received activity within the last 7 days. */
  recentlyActive: boolean;
  /** Open cases only; closed/cancelled cases never match automatically. */
  caseIsOpen: boolean;
}

export interface CaseMatchResult {
  caseId: string | null;
  confidence: number;
  reason: string[];
}

/**
 * Weights are calibrated so that a decisive CONTENT match on a fresh case
 * (no conversation history yet — the common first follow-up email) reaches
 * the ≥0.90 AUTO band, while property+type alone (0.10+0.10) can never leave
 * the manual band. Thread identity remains the strongest single signal.
 */
const WEIGHTS = {
  sameConversation: 0.45,
  sameCommunicationThread: 0.3,
  sameExternalEntity: 0.4,
  sameProperty: 0.1,
  sameContact: 0.2,
  sameCaseType: 0.1,
  subjectSimilarity: 0.25,
  contentSimilarity: 0.25,
  recentlyActive: 0.05,
} as const;

/**
 * Score one candidate case. Returns confidence 0..1 with human-readable
 * reasons. Callers must apply band policy (bandOf) to decide automation.
 */
export function scoreCaseMatch(
  evidence: CaseMatchEvidence,
): { confidence: number; reason: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const add = (hit: boolean, weight: number, label: string) => {
    if (!hit) return;
    score += weight;
    reasons.push(label);
  };

  add(evidence.sameConversation, WEIGHTS.sameConversation, 'same conversation thread');
  add(evidence.sameCommunicationThread, WEIGHTS.sameCommunicationThread, 'existing communication thread');
  add(evidence.sameExternalEntity, WEIGHTS.sameExternalEntity, 'same linked external entity');
  add(evidence.sameProperty, WEIGHTS.sameProperty, 'same property');
  add(evidence.sameContact, WEIGHTS.sameContact, 'same participants');
  add(evidence.sameCaseType, WEIGHTS.sameCaseType, 'same case type');
  if (evidence.subjectSimilarity > 0) {
    score += WEIGHTS.subjectSimilarity * evidence.subjectSimilarity;
    if (evidence.subjectSimilarity >= 0.5) reasons.push('similar subject');
  }
  if (evidence.contentSimilarity > 0) {
    score += WEIGHTS.contentSimilarity * evidence.contentSimilarity;
    if (evidence.contentSimilarity >= 0.5) reasons.push('similar content');
  }
  add(evidence.recentlyActive, WEIGHTS.recentlyActive, 'recent activity');

  if (!evidence.caseIsOpen) return { confidence: 0, reason: ['case not open'] };
  return { confidence: Math.min(1, Math.round(score * 100) / 100), reason: reasons };
}

// --- Text similarity helpers ---------------------------------------------------

export function normaliseEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'still', 'not', 'and', 'to', 'of', 'in',
  'hi', 'hello', 'please', 'could', 'would', 'any', 'update', 'regards', 'thanks',
  're', 'fw', 'fwd',
]);

export function normaliseText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Jaccard-style overlap of normalised tokens, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseText(a));
  const tb = new Set(normaliseText(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

/**
 * Share of the needle's distinctive tokens found in the haystack text, 0..1.
 * Used for external-entity evidence: "how much of the maintenance job's
 * topic signature does this message talk about?" Robust to long emails
 * where Jaccard's max-denominator would dilute a strong topical hit.
 */
export function tokenCoverage(needleText: string, haystackText: string): number {
  const needles = [...new Set(normaliseText(needleText))];
  if (needles.length === 0) return 0;
  const hay = new Set(normaliseText(haystackText));
  let hits = 0;
  for (const t of needles) if (hay.has(t)) hits += 1;
  return hits / needles.length;
}
