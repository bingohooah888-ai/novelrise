import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './stripe-sandbox',
  outputDir: 'stripe-sandbox-test-results',
  preserveOutput: 'failures-only',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['github'],
    ['list'],
    [
      'html',
      {
        outputFolder: 'stripe-sandbox-playwright-report',
        open: 'never'
      }
    ]
  ],
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'stripe-sandbox-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        channel: 'chrome'
      }
    }
  ]
});
