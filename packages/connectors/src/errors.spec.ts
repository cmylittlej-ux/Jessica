import { describe, expect, it } from 'vitest';
import { ConnectorError, isConnectorError } from './errors.ts';

describe('ConnectorError (Spec §29)', () => {
  it('preserves code, message and technical details', () => {
    const error = new ConnectorError('PERSISTENCE', 'query failed', {
      name: 'PgError',
      message: 'connection refused',
    });
    expect(error.code).toBe('PERSISTENCE');
    expect(error.message).toBe('query failed');
    expect(error.details).toEqual({ name: 'PgError', message: 'connection refused' });
    expect(error.name).toBe('ConnectorError');
  });

  it('is a real Error usable in Result.err branches', () => {
    const error = new ConnectorError('VALIDATION', 'content must not be empty');
    expect(isConnectorError(error)).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('isConnectorError rejects plain values', () => {
    expect(isConnectorError(new Error('plain'))).toBe(false);
    expect(isConnectorError('nope')).toBe(false);
    expect(isConnectorError(null)).toBe(false);
  });

  it('covers the taxonomy codes required by Spec §29', () => {
    const codes = ['NOT_FOUND', 'VALIDATION', 'PERSISTENCE', 'CONFLICT'] as const;
    for (const code of codes) {
      expect(new ConnectorError(code, 'x').code).toBe(code);
    }
  });
});
