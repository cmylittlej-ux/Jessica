/**
 * @reos/workflows
 *
 * Business workflow engine (Spec §26-28). Phase 4 delivers:
 *   inbound-email/   processInboundCommunication — 15-step deterministic pipeline
 *   approval/        PROPOSED → APPROVED → EXECUTED / REJECTED state machine
 * Every mutation writes Activity + AuditLog; every AI external action
 * requires human approval before execution.
 */
export const PACKAGE_NAME = '@reos/workflows';
