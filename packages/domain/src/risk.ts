/**
 * Risk policy (Spec Hardening §16, §17).
 *
 * Confidence = how sure the AI is. Risk = business damage if the AI is wrong.
 * They are independent axes: a 0.99-confidence offer acceptance is still a
 * CRITICAL-risk action that may never be bulk-approved.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Action types whose external effect can be auto-approved in bulk when they
 * are LOW risk AND confidence ≥ threshold. Everything else — including every
 * type below and any future type — always requires individual human approval.
 */
export const BULK_APPROVE_ALLOWLIST = ['GENERATE_REPLY'] as const;

export type BulkApproveActionType = (typeof BULK_APPROVE_ALLOWLIST)[number];

/** §17: never bulk-approvable regardless of confidence. */
export const NEVER_BULK_APPROVE_TYPES = [
  // Offer / negotiation / contract
  'OFFER_ACCEPTANCE',
  'PRICE_NEGOTIATION_COMMITMENT',
  'CONTRACT_CHANGE',
  // Lease legal changes
  'LEASE_LEGAL_CHANGE',
  'NOTICE_ISSUE',
  'RENT_ADJUSTMENT',
  // Authority / money / compliance
  'OWNER_AUTHORITY_OVERRIDE',
  'FINANCIAL_INSTRUCTION',
  'TRUST_MONEY_DISBURSEMENT',
  'COMPLIANCE_ACTION',
] as const;

/**
 * Default risk classification for known action types. The mapping errs on the
 * side of caution: unknown types classify as CRITICAL.
 */
const RISK_BY_ACTION_TYPE: Record<string, RiskLevel> = {
  GENERATE_REPLY: 'LOW', // routine acknowledgement content, human-reviewed send
  SEND_EMAIL: 'MEDIUM', // direct outbound communication
  CREATE_TASK: 'LOW', // internal effect only
  CLASSIFY_COMMUNICATION: 'LOW', // internal effect only
  SUMMARISE_CASE: 'LOW', // internal effect only
  RECOMMEND_ACTIONS: 'LOW', // internal effect only
  TRANSLATE: 'LOW', // derived data only
};

export function classifyActionRisk(actionType: string): RiskLevel {
  return RISK_BY_ACTION_TYPE[actionType] ?? 'CRITICAL';
}

export interface BulkApproveDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Bulk approve gate (§16): must satisfy ALL of
 *   actionType ∈ explicit allowlist  AND  risk === LOW  AND
 *   confidence ≥ threshold.
 * A missing risk level fails closed.
 */
export function bulkApproveDecision(input: {
  actionType: string;
  riskLevel?: string | null;
  confidence?: number | null;
  threshold?: number;
}): BulkApproveDecision {
  const threshold = input.threshold ?? 0.9;
  if (!(BULK_APPROVE_ALLOWLIST as readonly string[]).includes(input.actionType)) {
    return { allowed: false, reason: `actionType ${input.actionType} is not in the bulk allowlist` };
  }
  if (input.riskLevel !== 'LOW') {
    return { allowed: false, reason: `riskLevel ${input.riskLevel ?? 'UNKNOWN'} is not LOW` };
  }
  if ((input.confidence ?? -1) < threshold) {
    return { allowed: false, reason: `confidence ${input.confidence ?? 'UNKNOWN'} < ${threshold}` };
  }
  return { allowed: true, reason: 'allowlist + LOW risk + high confidence' };
}
