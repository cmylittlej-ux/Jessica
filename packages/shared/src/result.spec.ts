import { describe, expect, it } from 'vitest';
import { err, isOk, ok, unwrapOr, type Result } from './result';

describe('Result', () => {
  it('wraps success values', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('wraps errors without throwing', () => {
    const r: Result<number> = err(new Error('boom'));
    expect(r.ok).toBe(false);
    expect(unwrapOr(r, -1)).toBe(-1);
  });

  it('unwraps success values with fallback', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
  });
});
