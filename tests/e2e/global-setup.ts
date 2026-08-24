import { spawnSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

/**
 * Deterministic starting state for the mandatory E2E scenarios: re-apply
 * migrations and reseed. The seed is byte-stable (SEED_EPOCH), so every e2e
 * run starts from exactly the same dataset.
 *
 * NODE_OPTIONS is stripped because the WorkBuddy sandbox injects an fs shim
 * that breaks drizzle/tsx at runtime (see docs/decisions/ADR-0002).
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://reos:reos@localhost:5432/reos';

  const env = { ...process.env, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv;
  delete env.NODE_OPTIONS;

  const result = spawnSync('pnpm', ['db:reset'], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `db:reset failed with exit code ${result.status} — is Postgres running? (docker compose up -d db)`,
    );
  }
}
