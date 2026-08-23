import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './production-auth',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['github'], ['list']],
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://novelrise.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'production-authenticated-desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium'
      }
    }
  ]
});
