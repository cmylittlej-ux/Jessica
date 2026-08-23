/**
 * Connector error taxonomy (Spec §29 — no silent fail).
 * Connectors never throw across layers; they return Result<T, ConnectorError>.
 */

export type ConnectorErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'PERSISTENCE'
  | 'CONFLICT';

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  /** Technical details kept for backend logging; UI shows only `message`. */
  readonly details?: unknown;

  constructor(code: ConnectorErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.details = details;
  }
}

export function isConnectorError(value: unknown): value is ConnectorError {
  return value instanceof ConnectorError;
}
