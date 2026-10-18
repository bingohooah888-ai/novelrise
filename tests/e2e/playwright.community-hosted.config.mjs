import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL;
if (!baseURL) {
  throw new Error('Exact protected hosted Preview URL is required.');
}

export default defineConfig({
  testDir: './staging',
  testMatch: 'community-hosted-auth-write.spec.js',
  outputDir: 'hosted-write-test-results',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  use: {
    baseURL,
    actionTimeout: 15000,
    navigationTimeout: 20000,
    // Do not persist real synthetic test-user passwords or tokens to artifacts.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass':
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        }
      : {}
  },
  projects: [
    {
      name: 'hosted-synthetic-auth-chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? { channel: 'chrome' } : {})
      }
    }
  ]
});
