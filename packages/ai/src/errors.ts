/**
 * AI error taxonomy (Spec §29). Like ConnectorError, AI errors are returned
 * as Result values — never thrown across layer boundaries.
 */

export type AIErrorCode =
  /** Provider output failed its Zod schema — do not execute, mark AI_FAILED. */
  | 'VALIDATION'
  | 'PROVIDER_FAILURE';

export class AIError extends Error {
  readonly code: AIErrorCode;
  /** Technical details for backend logs; UI shows only `message`. */
  readonly details?: unknown;
  /** Zod issue list when code === 'VALIDATION'. */
  readonly issues?: unknown;

  constructor(code: AIErrorCode, message: string, details?: unknown, issues?: unknown) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.details = details;
    this.issues = issues;
  }
}

export function isAIError(value: unknown): value is AIError {
  return value instanceof AIError;
}
