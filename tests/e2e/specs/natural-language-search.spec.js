import { expect, test } from '@playwright/test';

async function installSearchStub(page) {
  await page.addInitScript(() => {
    globalThis.__NOVELIGHT_B24_CALLS__ = [];
  });

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const calls = window.__NOVELIGHT_B24_CALLS__;
          const novels = [
            {
              novel_id: 'natural-1',
              title: '涙の向こう側',
              description: '切ない恋愛と感動の物語',
              genre: '恋愛',
              created_at: '2026-09-19T00:00:00Z',
              pv: 12,
              favorite_count: 2
            },
            {
              novel_id: 'natural-2',
              title: '星間恋愛',
              description: '宇宙を旅する二人の恋愛',
              genre: 'SF',
              created_at: '2026-09-18T00:00:00Z',
              pv: 30,
              favorite_count: 4
            }
          ];

          function rpc(name, args = {}) {
            calls.push({ name, args });
            if (name === 'novelight_trusted_discovery_feed') {
              return Promise.resolve({ data: [], error: null });
            }
            if (name === 'novelight_neutral_search') {
              return Promise.resolve({ data: novels, error: null });
            }
            if (name === 'novelight_public_thumbnail_urls') {
              return Promise.resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: true, error: null });
          }
          function from(table) {
            return {
              select() {
                return {
                  in() {
                    if (table !== 'novels') {
                      return Promise.resolve({ data: [], error: null });
                    }
                    return Promise.resolve({
                      data: [
                        { id: 'natural-1', ai_usage: 'human', content_rating: 'general' },
                        { id: 'natural-2', ai_usage: 'human', content_rating: 'general' }
                      ],
                      error: null
                    });
                  }
                };
              }
            };
          }

          const client = {
            auth: {
              getSession: async () => ({ data: { session: null }, error: null })
            },
            rpc,
            from
          };

          window.supabase = { createClient: () => client };
        })();
        `
      });
    }
  );
}

test('natural-language search explains matches and keeps relevance separate', async ({
  page
}) => {
  await installSearchStub(page);
  await page.goto('/search.html');

  await expect(page.locator('#naturalModeButton')).toBeVisible();
  await page.locator('#naturalModeButton').click();

  await expect(page.locator('#sortSelect')).toBeDisabled();
  await expect(page.locator('#naturalSearchNote')).toBeVisible();

  await page.locator('#keywordInput').fill('泣ける恋愛を読みたい');
  await expect(page.locator('#resultCount')).toContainText('自然文検索の候補');
  await expect(page.locator('.novel-card')).toHaveCount(2);
  await expect(page.locator('.novel-card').first()).toContainText(
    '涙の向こう側'
  );
  await expect(page.locator('.natural-match-reason').first()).toContainText(
    '一致理由'
  );
  await expect(page.locator('#naturalSearchIntent')).toContainText(
    'ジャンル: 恋愛'
  );

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_B24_CALLS__);
  const neutralCalls = calls.filter(
    (call) => call.name === 'novelight_neutral_search'
  );
  expect(neutralCalls.length).toBeGreaterThan(0);
  expect(
    calls.some((call) => call.name === 'record_neutral_search_impressions')
  ).toBeTruthy();
  expect(
    calls.some((call) => call.name === 'novelight_trusted_discovery_feed')
  ).toBeTruthy();
});
