import { expect, test as base } from '@playwright/test';

export const test = base.extend({
  _novelightDiagnostics: [
    async ({ page }, use, testInfo) => {
      const diagnostics = [];
      const record = (type, details = {}) => {
        diagnostics.push({
          at: new Date().toISOString(),
          type,
          ...details
        });
      };

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        record('console.error', { text: message.text() });
      });

      page.on('pageerror', (error) => {
        record('pageerror', {
          message: error.message,
          stack: error.stack || null
        });
      });

      page.on('requestfailed', (request) => {
        record('requestfailed', {
          method: request.method(),
          url: request.url(),
          failure: request.failure()?.errorText || null
        });
      });

      page.on('response', (response) => {
        if (response.status() < 400) return;
        record('http-error', {
          status: response.status(),
          method: response.request().method(),
          url: response.url()
        });
      });

      await use();

      if (testInfo.status === testInfo.expectedStatus) return;

      let title = null;
      let html = null;
      try {
        title = await page.title();
        html = await page.content();
      } catch (error) {
        record('diagnostic-capture-error', { message: error.message });
      }

      record('page-state', {
        url: page.url(),
        title
      });

      await testInfo.attach('browser-diagnostics', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json'
      });

      if (html) {
        await testInfo.attach('page-html', {
          body: Buffer.from(html),
          contentType: 'text/html'
        });
      }
    },
    { auto: true }
  ]
});

export { expect };
