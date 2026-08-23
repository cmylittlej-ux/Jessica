import { describe, expect, it } from 'vitest';
import { ok } from '../../packages/shared/src/index';
import { PACKAGE_NAME as DbName } from '../../packages/db/src/index';

/**
 * Phase 0 wiring smoke test: proves that workspace packages resolve,
 * compile and are importable from outside their own package.
 */
describe('workspace wiring', () => {
  it('imports shared utilities across packages', () => {
    expect(ok(1).ok).toBe(true);
    expect(DbName).toBe('@reos/db');
  });
});
