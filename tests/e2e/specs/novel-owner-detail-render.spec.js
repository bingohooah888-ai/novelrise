import { expect, test } from '../fixtures/diagnostic-fixture.js';

const SAMPLE_SYNOPSIS =
  'かつて天才だった少年が新しい勝ち方を見つけていく。'.repeat(24);

const COVER_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="navy"/></svg>'
);

test('novel owner sees title, synopsis, LIGHT SEED and received-seed panel', async ({
  page
}) => {
  await page.addInitScript(({ synopsis, cover }) => {
    globalThis.__NOVEL_DETAIL_TEST_SYNOPSIS__ = synopsis;
    globalThis.__NOVEL_DETAIL_TEST_COVER__ = cover;
  }, { synopsis: SAMPLE_SYNOPSIS, cover: COVER_IMAGE });
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
          const novel = {
            id: 354, user_id: 'test-author', status: 'published',
            title: '作品タイトルの表示確認', genre: '現代ファンタジー',
            description: window.__NOVEL_DETAIL_TEST_SYNOPSIS__,
            thumbnail_url: window.__NOVEL_DETAIL_TEST_COVER__,
            ai_usage: 'human', content_rating: 'general', content_warnings: [],
            created_at: '2026-09-28T00:00:00Z', show_episode_numbers: true
          };
          function builder(table) {
            let selected = '';
            const api = {
              select(fields) { selected = fields; return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              range() { return api; },
              // The custom-cover lookup is deliberately stalled. The saved
              // render should be visible independently of this optional RPC.
              maybeSingle: async () => table === 'novel_custom_covers'
                ? new Promise(() => {})
                : { data: table === 'novels' ? novel : null, error: null },
              single: async () => ({
                data: table === 'novels'
                  ? selected === 'description'
                    ? { description: novel.description }
                    : novel
                  : null,
                error: null
              }),
              then(resolve, reject) {
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
              }
            };
            return api;
          }
          const client = {
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'test-author' } } },
                error: null
              }),
              getUser: async () => ({
                data: { user: { id: 'test-author' } }, error: null
              }),
              onAuthStateChange: () => ({
                data: { subscription: { unsubscribe() {} } }
              })
            },
            rpc: async (name) => ({
              data: name === 'novelight_novel_outline' ? [
                {
                  episode_id: 991, episode_number: 1,
                  episode_title: '公開中の第一話',
                  episode_status: 'published',
                  chapter_id: null, chapter_title: null
                },
                {
                  episode_id: 992, episode_number: 2,
                  episode_title: '下書きの第二話',
                  episode_status: 'draft',
                  chapter_id: null, chapter_title: null
                }
              ] : name === 'novelight_public_profile'
                ? [{ display_name: '作者の表示確認' }]
                : name === 'light_seed_status_v2'
                  ? {
                    reason: 'own_novel',
                    monthly_limit: 3, remaining_this_month: 2,
                    total_seed_count: 2, gold_remaining: 0,
                    silver_remaining: 0, bronze_remaining: 0
                  }
                  : name === 'novelight_author_received_light_seed_summary'
                    ? { total: 2, gold: 1, silver: 1, bronze: 0 }
                    : [],
              error: null
            }),
            from: (table) => builder(table)
          };
          window.supabase = { createClient: () => client };
        })();
      `
    });
  });

  await page.goto('/novel.html?id=354', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.nl-work-detail-grid')).toBeVisible();
  const cover = page.locator('.nl-work-detail-cover img');
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.nl-work-detail-main > .title')).toBeVisible();
  await expect(page.locator('.nl-work-detail-main > .title')).toContainText(
    '作品タイトルの表示確認'
  );
  await expect(page.locator('.nl-work-detail-main > .author')).toBeVisible();
  await expect(page.locator('.nl-work-detail-left .tags')).toContainText(
    '現代ファンタジー'
  );
  const synopsis = page.locator(
    '.nl-work-detail-synopsis .novelight-native-synopsis'
  );
  await expect(synopsis).toBeVisible();
  await expect(synopsis.locator('summary')).toBeVisible();
  await expect(synopsis.locator('summary')).toContainText(
    'かつて天才だった少年'
  );
  await synopsis.locator('summary').click();
  await expect(synopsis).toHaveAttribute('open');
  await expect(synopsis.locator('.description')).toHaveText(SAMPLE_SYNOPSIS);

  await expect(page.locator('#lightSeedArea')).toBeVisible();
  await expect(page.locator('#lightSeedArea')).toContainText('LIGHT SEED');
  await expect(page.locator('#receivedSeedArea')).toBeVisible();
  await expect(page.locator('.nl-work-detail-bookmeta')).toBeVisible();
  await expect(page.locator('.nl-work-detail-toc')).toContainText('下書き');
});
