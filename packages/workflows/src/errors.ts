/**
 * Workflow error taxonomy (Spec §29). Workflows return Results; a thrown
 * WorkflowError signals a programming bug, never an expected branch.
 */

export type WorkflowErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'DEPENDENCY_FAILURE';

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly details?: unknown;

  constructor(code: WorkflowErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
  }
}
