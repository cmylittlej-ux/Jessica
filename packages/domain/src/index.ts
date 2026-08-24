/**
 * @reos/domain — pure business rules (Spec Hardening §29).
 *
 * No database, no framework. @reos/db owns persistence; workflows orchestrate;
 * this package owns POLICY: confidence bands, risk classification, bulk
 * approval allowlist, case matching scores, source-of-truth ownership and
 * workflow status closure.
 */
export {
  AUTO_LINK_THRESHOLD,
  REVIEW_THRESHOLD,
  bandOf,
  automationAllowed,
  type ConfidenceBand,
} from './confidence.ts';
export {
  BULK_APPROVE_ALLOWLIST,
  NEVER_BULK_APPROVE_TYPES,
  bulkApproveDecision,
  classifyActionRisk,
  type BulkApproveActionType,
  type RiskLevel,
} from './risk.ts';
export {
  normaliseEmail,
  normaliseText,
  scoreCaseMatch,
  tokenCoverage,
  tokenSimilarity,
  type CaseMatchEvidence,
  type CaseMatchResult,
} from './matching.ts';
export {
  SOURCE_OWNED_FIELDS,
  SOURCE_OWNERSHIP,
  sourceOwnerOf,
  sourceOwnerOf as ownerOf,
  type OwnedBy,
  type SourceSystem,
} from './ownership.ts';
export {
  statusAfterReplySent,
  statusOnCompletion,
  statusOnFollowUpDue,
  type CaseWorkflowStatus,
} from './workflowClosure.ts';
