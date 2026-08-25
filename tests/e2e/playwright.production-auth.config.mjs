import { defineConfig, devices } from '@playwright/test';

const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './production-auth',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['github'], ['list']],
  timeout: 150_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://novelrise.vercel.app',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    ...(vercelBypassSecret
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': vercelBypassSecret
          }
        }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'production-authenticated-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        channel: 'chrome'
      }
    }
  ]
});
