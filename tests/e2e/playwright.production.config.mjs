import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './production',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [['github'], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://novelrise.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'production-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        channel: 'chrome'
      }
    }
  ]
});
