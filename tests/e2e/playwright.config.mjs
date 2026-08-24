import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const reporters = process.env.CI
  ? [
      ['github'],
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ]
  : [
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ];

export default defineConfig({
  testDir: './specs',
  outputDir: 'test-results',
  preserveOutput: 'failures-only',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: reporters,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'node static-server.mjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium'
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium'
      }
    }
  ]
});
