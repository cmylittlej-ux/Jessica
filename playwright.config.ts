import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — mandatory E2E scenarios land in Phase 7 (Spec §32-34).
 * Browsers are not downloaded during Phase 0 to keep the foundation lean.
 * Run `pnpm exec playwright install chromium` before first e2e run.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
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
    command: 'pnpm --filter @reos/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
