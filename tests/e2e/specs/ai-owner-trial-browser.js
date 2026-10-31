// Isolated Chromium exercise; fake JWT and fake provider, no hosted traffic.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function isolated(page) {
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.route('**/api/ai-owner-bible-**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.goto('/story-notes.html', { waitUntil: 'domcontentloaded' });
}

// Browser-only synthetic fixture with network denied and no actual provider.
// prettier-ignore
test('private owner can explicitly run once and review pending candidate', async ({ page }) => {
  await isolated(page);
  const mounted = await page.evaluate(async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const state = {
      calls: [],
      session: {
        user: { id: owner },
        access_token: 'synthetic-no-real-jwt-token'
      },
      listener: null
    };
    globalThis.__ownerTrialFixture = state;
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
              subscription: { unsubscribe() { state.listener = null; } }
            }
          };
        }
      }
    };
    const fetcher = async (url, options) => {
      state.calls.push({
        url,
        method: options.method,
        body: options.body ?? null
      });
      if (
        url.startsWith('/api/ai-owner-bible-analyze?') &&
        options.method === 'GET'
      ) {
        return {
          ok: true,
          json: async () => ({
            trialReady: true,
            novelId: 41,
            episodeId: 11,
            chunkIndex: 0
          })
        };
      }
      if (url === '/api/ai-owner-bible-analyze') {
        return {
          ok: true,
          json: async () => ({
            novelId: 41,
            stagedCount: 1,
            requiresAuthorReview: true
          })
        };
      }
      if (
        url.startsWith('/api/ai-owner-bible-review?') &&
        options.method === 'GET'
      ) {
        return {
          ok: true,
          json: async () => ({
            novelId: 41,
            candidates: [{
              id: 77,
              episodeId: 11,
              revision: 1,
              status: 'pending',
              kind: 'character',
              key: '凛',
              summary: '青い鍵を持つ',
              evidence: '凛は青い鍵を持っていた。'
            }]
          })
        };
      }
      throw new Error('Unapproved synthetic browser request');
    };
    return globalThis.NovelightAiBibleTrialPanel.attach({
      client,
      novelId: 41,
      ownerId: owner,
      fetcher
    });
  });
  expect(mounted).toBe(true);
  const panel = page.locator('.novelight-ai-bible-trial-section');
  await expect(panel).toBeVisible();
  const run = panel.getByRole('button', { name: 'この1話をAI解析する' });
  const initialCalls = await page.evaluate(
    () => globalThis.__ownerTrialFixture.calls
  );
  expect(initialCalls.map((call) => call.method)).toEqual(['GET']);
  await run.click();
  await expect(run).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('1件');
  const review = page.getByText('凛：凛').first();
  await expect(page.getByRole('heading', { name: '作品カルテ・AI候補の確認（管理人限定）' })).toBeVisible();
  await expect(page.getByText('本文根拠：凛は青い鍵を持っていた。')).toBeVisible();
  await expect(review).toHaveCount(0);
  const calls = await page.evaluate(
    () => globalThis.__ownerTrialFixture.calls
  );
  expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
  expect(JSON.parse(calls[1].body)).toEqual({
    novelId: 41,
    episodeId: 11,
    chunkIndex: 0
  });
  await page.evaluate(() => {
    const f = globalThis.__ownerTrialFixture;
    f.session = null;
    f.listener?.('SIGNED_OUT', null);
  });
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '作品カルテ・AI候補の確認（管理人限定）' })).toHaveCount(0);
});

// prettier-ignore
test('server denial hides trial UI and makes no paid request', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const session = {
      user: { id: owner },
      access_token: 'synthetic-no-real-jwt-token'
    };
    let count = 0;
    const client = {
      auth: {
        getSession: async () => ({
          data: { session },
          error: null
        }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe() {} } }
        })
      }
    };
    const mounted = await globalThis.NovelightAiBibleTrialPanel.attach({
      client,
      novelId: 41,
      ownerId: owner,
      fetcher: async () => {
        count += 1;
        return { ok: false };
      }
    });
    return { mounted, count };
  });
  expect(result).toEqual({ mounted: false, count: 1 });
  await expect(
    page.locator('.novelight-ai-bible-trial-section')
  ).toHaveCount(0);
});
