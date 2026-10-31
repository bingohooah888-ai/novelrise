// Local-only browser exercise: synthetic owner, disclosure, and HTTP receipts.
// No hosted Staging, Production DB, Auth user, external model, or paid call.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function openIsolatedNotes(page) {
  // Explicitly deny every real Supabase and consent API request.
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.route('**/api/ai-owner-bible-consent**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.goto('/story-notes.html', { waitUntil: 'domcontentloaded' });
}

test('private consent UI grants, revokes, and hides on sign-out', async ({
  page
}) => {
  await openIsolatedNotes(page);
  const mounted = await page.evaluate(async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const state = {
      status: 'none',
      requests: [],
      listener: null,
      session: {
        user: { id: owner },
        access_token: 'synthetic-local-browser-token'
      }
    };
    globalThis.__consentBrowserFixture = state;
    const client = {
      auth: {
        getSession: async () => ({
          data: { session: state.session },
          error: null
        }),
        onAuthStateChange(callback) {
          state.listener = callback;
          return {
            data: {
              subscription: {
                unsubscribe() {
                  state.listener = null;
                }
              }
            }
          };
        }
      }
    };
    const fetcher = async (_url, options) => {
      state.requests.push({
        method: options.method,
        body: options.body || null
      });
      if (options.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            novelId: 41,
            policyRevision: 'synthetic-20261031',
            aiEnabled: false,
            disclosures: [
              {
                processor: 'openai',
                label: '架空の外部AI事業者',
                purpose: '同意画面の表示検証',
                dataSent: '架空の文章のみ',
                retention: '送信しない',
                internationalTransfer: '送信しない',
                status: state.status,
                expiresAt:
                  state.status === 'active'
                    ? '2026-11-29T10:00:00Z'
                    : null
              }
            ]
          })
        };
      }
      const body = JSON.parse(options.body);
      state.status = body.action === 'grant' ? 'active' : 'revoked';
      return {
        ok: true,
        json: async () => ({
          novelId: 41,
          processor: 'openai',
          status: body.action === 'grant' ? 'granted' : 'revoked',
          aiEnabled: false
        })
      };
    };
    return globalThis.NovelightAiBibleConsentPanel.attach({
      client,
      novelId: 41,
      ownerId: owner,
      fetcher
    });
  });
  expect(mounted).toBe(true);

  const panel = page.locator('.novelight-ai-bible-consent-section');
  const button = panel.locator('.novelight-ai-bible-consent-row button');
  const checkbox = panel.locator('.novelight-ai-bible-consent-label input');
  await expect(panel).toBeVisible();
  await expect(button).toHaveText('同意する');
  await expect(panel.locator('p').first()).toHaveCSS(
    'color',
    'rgb(211, 222, 233)'
  );
  await expect(button).toHaveCSS('color', 'rgb(23, 51, 75)');
  await button.click();
  expect(
    await page.evaluate(
      () => globalThis.__consentBrowserFixture.requests.length
    )
  ).toBe(1);

  await checkbox.check();
  await button.click();
  await expect(button).toHaveText('同意を撤回');
  await expect.poll(() =>
    page.evaluate(() => globalThis.__consentBrowserFixture.requests.length)
  ).toBe(3);
  await button.focus();
  await expect(button).toHaveCSS('outline-style', 'solid');

  await button.click();
  await expect(button).toHaveText('同意する');
  await expect(checkbox).not.toBeChecked();
  await expect.poll(() =>
    page.evaluate(() => globalThis.__consentBrowserFixture.requests.length)
  ).toBe(5);
  const requests = await page.evaluate(
    () => globalThis.__consentBrowserFixture.requests
  );
  expect(requests.map((request) => request.method)).toEqual([
    'GET',
    'POST',
    'GET',
    'POST',
    'GET'
  ]);
  expect(JSON.parse(requests[1].body)).toMatchObject({
    action: 'grant',
    acceptedExternalProcessing: true
  });
  expect(JSON.parse(requests[3].body).action).toBe('revoke');

  await page.evaluate(() => {
    const fixture = globalThis.__consentBrowserFixture;
    fixture.session = null;
    fixture.listener?.('SIGNED_OUT', null);
  });
  await expect(panel).toHaveCount(0);
});

test('server denial keeps the consent controls off-DOM', async ({ page }) => {
  await openIsolatedNotes(page);
  const mounted = await page.evaluate(async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    let requests = 0;
    const client = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: owner },
              access_token: 'synthetic-local-browser-token'
            }
          },
          error: null
        }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe() {} } }
        })
      }
    };
    const result = await globalThis.NovelightAiBibleConsentPanel.attach({
      client,
      novelId: 41,
      ownerId: owner,
      fetcher: async () => {
        requests += 1;
        return { ok: false };
      }
    });
    return { result, requests };
  });
  expect(mounted).toEqual({ result: false, requests: 1 });
  await expect(
    page.locator('.novelight-ai-bible-consent-section')
  ).toHaveCount(0);
});
