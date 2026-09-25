import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vercelConfig = JSON.parse(
  readFileSync(`${repositoryRoot}/vercel.json`, 'utf8')
);
const expectedCsp = vercelConfig.headers?.[0]?.headers?.find(
  ({ key }) => key.toLowerCase() === 'content-security-policy'
)?.value;
const routes = [
  '/index.html',
  '/login.html',
  '/signup.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/mypage.html',
  '/episode-post.html',
  '/my-novels.html',
  '/author-notes.html',
  '/analytics.html',
  '/interaction-settings.html',
  '/account-settings.html',
  '/scout-record.html',
  '/novel.html',
  '/episode.html',
  '/favorites.html',
  '/search.html'
];

async function suppressProductionWrites(page) {
  await page.route('**/api/analytics-event', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"accepted":false,"recorded_count":0}'
    });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    if (url.pathname.includes('/rpc/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'null'
      });
      return;
    }

    await route.abort('blockedbyclient');
  });
}

test('deployed CSP executes critical routes without policy violations', async ({
  page
}) => {
  const cspConsoleErrors = [];
  const cspRequestFailures = [];

  await suppressProductionWrites(page);

  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security policy|refused to (?:load|execute|apply|connect|send|submit)/iu.test(
        message.text()
      )
    ) {
      cspConsoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || '';
    if (/csp|content security policy/iu.test(errorText)) {
      cspRequestFailures.push(
        `${request.method()} ${request.url()}: ${errorText}`
      );
    }
  });
  await page.addInitScript(() => {
    globalThis.__novelightCspViolations = [];
    globalThis.document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__novelightCspViolations.push({
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective
      });
    });
  });

  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: 'load' });
    expect(response?.ok(), `${route} should load`).toBeTruthy();
    expect(
      response?.headers()['content-security-policy'],
      `${route} should receive the reviewed CSP`
    ).toBe(expectedCsp);

    const result = await page.evaluate(() => ({
      violations: globalThis.__novelightCspViolations || [],
      blockedStylesheets: [
        ...globalThis.document.querySelectorAll('link[rel="stylesheet"]')
      ]
        .filter((link) => !link.sheet)
        .map((link) => link.href),
      inlineRuntimeCount:
        globalThis.document.querySelectorAll('script:not([src])').length
    }));

    expect(result.violations, `${route} CSP violations`).toEqual([]);
    expect(result.blockedStylesheets, `${route} blocked stylesheets`).toEqual(
      []
    );
    if (route !== '/analytics.html' && route !== '/scout-record.html') {
      expect(
        result.inlineRuntimeCount,
        `${route} should expose a hash-authorized page runtime`
      ).toBeGreaterThan(0);
    }
  }

  expect(cspConsoleErrors).toEqual([]);
  expect(cspRequestFailures).toEqual([]);
});
