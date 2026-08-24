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
  GENERATE_REPLY: 'LOW', // base level — raised by business context below
  SEND_EMAIL: 'MEDIUM', // direct outbound communication
  CREATE_TASK: 'LOW', // internal effect only
  CLASSIFY_COMMUNICATION: 'LOW', // internal effect only
  SUMMARISE_CASE: 'LOW', // internal effect only
  RECOMMEND_ACTIONS: 'LOW', // internal effect only
  TRANSLATE: 'LOW', // derived data only
};

/**
 * P0 Closure §2: risk is CONTEXT-aware, never action-type-only. A
 * GENERATE_REPLY for an offer acknowledgement, complaint or legal matter
 * carries far more business risk than a routine maintenance ack.
 */
export interface ActionRiskContext {
  actionType: string;
  /** Case classification context — drives escalation above the base level. */
  businessDomain?: string | null;
  caseType?: string | null;
  actionRequired?: string | null;
  priority?: string | null;
  /** Reserved signals — any truthy value escalates straight to CRITICAL. */
  legalSignal?: boolean;
  financialSignal?: boolean;
  complianceSignal?: boolean;
}

/** Case types whose replies are never routine. */
const ELEVATED_CASE_TYPES: Record<string, RiskLevel> = {
  OFFER: 'MEDIUM', // offer acknowledgement — vendor decision stays human
  NEGOTIATION: 'HIGH',
  CONTRACT: 'HIGH',
  SOLICITOR: 'HIGH',
  COMPLAINT: 'HIGH',
  COMPLIANCE: 'CRITICAL',
  RENT_ADJUSTMENT: 'CRITICAL',
  ARREARS: 'HIGH',
};

/** Action-required values that always indicate elevated stakes. */
const ELEVATED_ACTION_REQUIRED: Record<string, RiskLevel> = {
  DECISION_REQUIRED: 'MEDIUM',
  LEGAL_REQUIRED: 'CRITICAL',
  COMPLIANCE_REQUIRED: 'CRITICAL',
};

/**
 * Classify the risk of an action from its full business context.
 * The result is the MAXIMUM of: base type risk, case-type escalation,
 * action-required escalation and explicit signal escalations.
 */
export function classifyActionRisk(inputOrType: ActionRiskContext | string): RiskLevel {
  const ctx: ActionRiskContext =
    typeof inputOrType === 'string' ? { actionType: inputOrType } : inputOrType;

  let risk = RISK_BY_ACTION_TYPE[ctx.actionType] ?? 'CRITICAL';
  const rank: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const escalate = (candidate: RiskLevel) => {
    if (rank[candidate] > rank[risk]) risk = candidate;
  };

  if (ctx.caseType) {
    const caseElevated = ELEVATED_CASE_TYPES[ctx.caseType];
    if (caseElevated) escalate(caseElevated);
  }
  if (ctx.actionRequired) {
    const elevated = ELEVATED_ACTION_REQUIRED[ctx.actionRequired];
    if (elevated) escalate(elevated);
  }
  if (ctx.priority === 'URGENT' || ctx.priority === 'HIGH') {
    escalate('MEDIUM');
  }
  if (ctx.legalSignal || ctx.financialSignal || ctx.complianceSignal) {
    escalate('CRITICAL');
  }
  return risk;
}

export interface BulkApproveDecision {
  allowed: boolean;
  reason: string;
}

/**
 * P0 Closure §2: case types / action-required values that can never be
 * bulk-approved even if every other gate passes.
 */
export const RESTRICTED_BULK_CASE_TYPES = [
  'OFFER',
  'NEGOTIATION',
  'CONTRACT',
  'SOLICITOR',
  'COMPLIANCE',
  'ARREARS',
  'RENT_ADJUSTMENT',
] as const;

export const RESTRICTED_BULK_ACTION_REQUIRED = [
  'DECISION_REQUIRED',
  'LEGAL_REQUIRED',
  'COMPLIANCE_REQUIRED',
  'URGENT_ACTION',
] as const;

/**
 * Bulk approve gate (§16 + P0 Closure §2): must satisfy ALL of
 *   actionType ∈ explicit allowlist  AND  risk === LOW  AND
 *   confidence ≥ threshold  AND  caseType not restricted  AND
 *   actionRequired not high-risk.
 * A missing risk level fails closed.
 */
export function bulkApproveDecision(input: {
  actionType: string;
  riskLevel?: string | null;
  confidence?: number | null;
  threshold?: number;
  caseType?: string | null;
  actionRequired?: string | null;
}): BulkApproveDecision {
  const threshold = input.threshold ?? 0.9;
  if (!(BULK_APPROVE_ALLOWLIST as readonly string[]).includes(input.actionType)) {
    return { allowed: false, reason: `actionType ${input.actionType} is not in the bulk allowlist` };
  }
  if (input.caseType && (RESTRICTED_BULK_CASE_TYPES as readonly string[]).includes(input.caseType)) {
    return { allowed: false, reason: `caseType ${input.caseType} is restricted from bulk approval` };
  }
  if (
    input.actionRequired &&
    (RESTRICTED_BULK_ACTION_REQUIRED as readonly string[]).includes(input.actionRequired)
  ) {
    return { allowed: false, reason: `actionRequired ${input.actionRequired} is restricted from bulk approval` };
  }
  if (input.riskLevel !== 'LOW') {
    return { allowed: false, reason: `riskLevel ${input.riskLevel ?? 'UNKNOWN'} is not LOW` };
  }
  if ((input.confidence ?? -1) < threshold) {
    return { allowed: false, reason: `confidence ${input.confidence ?? 'UNKNOWN'} < ${threshold}` };
  }
  return { allowed: true, reason: 'allowlist + LOW risk + high confidence + unrestricted context' };
}
