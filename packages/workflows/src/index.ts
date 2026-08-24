/**
 * @reos/workflows
 *
 * Business workflow engine (Spec §26–§28). Phase 4 delivers:
 *   inbound.ts   processInboundCommunication — deterministic pipeline from
 *                received email to Case/Task/AIAction/Approval + audit trail
 *   approval.ts  PROPOSED → APPROVED → EXECUTED / REJECTED state machine with
 *                edit-before-approval feedback capture
 *
 * Every mutation writes Activity + AuditLog; every AI external action
 * requires human approval before execution.
 */

export { WorkflowError, type WorkflowErrorCode } from './errors.ts';
export {
  createInboundWorkflow,
  type InboundOutcome,
  type ProcessedOutcome,
  type NeedsReviewOutcome,
  type InformationOutcome,
  type DuplicateOutcome,
  type InboundWorkflowDeps,
} from './inbound.ts';
export { createApprovalWorkflow, type DecisionInput } from './approval.ts';
export { processDueFollowUps, completeFollowUpTask } from './followups.ts';
export { ingestRawEmail, type RawEmailInput, type IngestResult } from './ingest.ts';
export {
  matchContactByEmail,
  matchProperty,
  matchCaseForMessage,
  type CaseMatchDecision,
  type ContactMatch,
  type PropertyMatch,
} from './matching.ts';
