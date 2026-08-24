import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — mandatory E2E scenarios (Spec §32-34).
 *
 * The three scenarios share one database, so they run serially against a
 * deterministic seed: global-setup.ts runs `pnpm db:reset` before the dev
 * server starts. Requires a running Postgres (docker compose up -d db) and
 * `pnpm exec playwright install chromium` once.
 *
 * Run: DATABASE_URL="postgresql://reos:reos@localhost:5432/reos" pnpm e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'NEXT_TELEMETRY_DISABLED=1 pnpm --filter @reos/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
