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
  type DuplicateOutcome,
  type InboundWorkflowDeps,
} from './inbound.ts';
export { createApprovalWorkflow, type DecisionInput } from './approval.ts';
