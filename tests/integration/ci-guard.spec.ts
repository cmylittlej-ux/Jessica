import { describe, expect, it } from 'vitest';

/**
 * Hardening §39 guard: database-backed integration tests must RUN in CI, never
 * silently skip. If CI is misconfigured (no Postgres / no DATABASE_URL) this
 * file FAILS the pipeline instead of letting the suite report a hollow green.
 */
describe('CI configuration guard (§39)', () => {
  it.skipIf(!process.env.CI)(
    'integration suite requires DATABASE_URL in CI — missing config must fail the build',
    () => {
      expect(
        process.env.DATABASE_URL,
        'DATABASE_URL is not set: integration tests would be skipped and "all green" would be meaningless. Configure the Postgres service in the CI workflow.',
      ).toBeTruthy();
    },
  );
});
