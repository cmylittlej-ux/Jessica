/**
 * Phase 2 §A2/§A3 — Follow-up & wake-up policy.
 *
 * Invariant: a Case may never enter WAITING without a future wake-up
 * mechanism. The wake-up is a follow-up Task with a dueAt; when it becomes
 * due the case advances to FOLLOW_UP_DUE, and completing the last blocking
 * task closes the loop to COMPLETED.
 *
 * Timing defaults live here (domain layer) — never hard-coded in UI or
 * workflow code — and are intentionally simple/configurable later.
 */

/** Default horizon for a follow-up task created as a WAITING wake-up: 3 days. */
export const DEFAULT_FOLLOW_UP_HORIZON_MS = 3 * 24 * 3600 * 1000;

export function defaultFollowUpDueAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_FOLLOW_UP_HORIZON_MS);
}

/**
 * §A3: task statuses that BLOCK case completion. Terminal statuses
 * (DONE / CANCELLED) never block.
 */
export const BLOCKING_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING'] as const;

export type BlockingTaskStatus = (typeof BLOCKING_TASK_STATUSES)[number];

export function isBlockingTaskStatus(status: string): status is BlockingTaskStatus {
  return (BLOCKING_TASK_STATUSES as readonly string[]).includes(status);
}
