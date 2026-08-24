/**
 * Workflow status closure policy (Spec Hardening §13).
 *
 * The workflow must never stall in NEW. After the human approves and sends,
 * a case that awaits the customer's reply moves to WAITING with a follow-up
 * task; when the follow-up becomes due → FOLLOW_UP_DUE; completing it closes
 * the loop → COMPLETED.
 */

export type CaseWorkflowStatus =
  | 'NEW'
  | 'AI_PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'FOLLOW_UP_DUE'
  | 'COMPLETED'
  | 'ARCHIVED';

/**
 * Status a case enters right after an outbound reply is sent.
 * Awaiting customer response ⇒ WAITING (with a follow-up task).
 *
 * P0 Closure §1: every pre-send state lands in WAITING. IN_PROGRESS is never
 * a post-send destination — a case must not hang there once we are waiting
 * on an external party.
 */
export function statusAfterReplySent(current: CaseWorkflowStatus): CaseWorkflowStatus {
  void current;
  return 'WAITING';
}

/** Follow-up deadline reached while waiting ⇒ FOLLOW_UP_DUE. */
export function statusOnFollowUpDue(current: CaseWorkflowStatus): CaseWorkflowStatus {
  return current === 'WAITING' || current === 'IN_PROGRESS' ? 'FOLLOW_UP_DUE' : current;
}

/** Follow-up completed (or manual close) ⇒ COMPLETED. */
export function statusOnCompletion(current: CaseWorkflowStatus): CaseWorkflowStatus | null {
  const closable: CaseWorkflowStatus[] = ['IN_PROGRESS', 'WAITING', 'FOLLOW_UP_DUE'];
  return closable.includes(current) ? 'COMPLETED' : null;
}
