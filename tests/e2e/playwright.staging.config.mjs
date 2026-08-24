import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL || process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('STAGING_BASE_URL or E2E_BASE_URL is required.');

export default defineConfig({
  testDir: './staging',
  outputDir: 'staging-test-results',
  preserveOutput: 'failures-only',
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { outputFolder: 'staging-playwright-report', open: 'never' }]
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'staging-playwright-report', open: 'never' }]
      ],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'staging-desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium'
      }
    }
  ]
});
