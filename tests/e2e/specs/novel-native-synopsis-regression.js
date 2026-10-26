import { expect, test } from '../fixtures/diagnostic-fixture.js';

const synopsis =
  '主人公が魔術学園で新たな仲間と出会い、自分なりの勝ち方を取り戻す。'.repeat(12);

async function stubNovel(page) {
  await page.addInitScript((description) => {
    globalThis.__NOVEL_DETAIL_SYNOPSIS__ = description;
  }, synopsis);

  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
          const work = {
            id: 354, user_id: 'author-test', title: '学園で見つけた新しい勝ち方',
            description: window.__NOVEL_DETAIL_SYNOPSIS__,
            status: 'published', genre: '現代ファンタジー', ai_usage: 'human',
            content_rating: 'general', content_warnings: [],
            created_at: '2026-09-28T00:00:00Z', show_episode_numbers: true
          };
          function builder(table) {
            let selected = '';
            const api = {
              select(columns) { selected = columns; return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              range() { return api; },
              maybeSingle: async () => ({
                data: table === 'novels' ? work : null, error: null
              }),
              single: async () => ({
                data: table === 'novels'
                  ? selected === 'description' ? { description: work.description } : work
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
              getSession: async () => ({ data: { session: null }, error: null }),
              getUser: async () => ({ data: { user: null }, error: null }),
              onAuthStateChange: () => ({
                data: { subscription: { unsubscribe() {} } }
              })
            },
            rpc: async (name) => ({
              data: name === 'novelight_novel_outline' ? [{
                episode_id: 9876, episode_number: 1, episode_title: '第一歩',
                episode_status: 'published', chapter_id: null, chapter_title: null
              }] : name === 'novelight_public_profile'
                ? [{ display_name: 'テスト作者' }] : [],
              error: null
            }),
            from: (table) => builder(table)
          };
          window.supabase = { createClient: () => client };
        })();
      `
    });
  });
}

test('work page keeps title, author, genre and native synopsis after layout enhancement', async ({
  page
}) => {
  await stubNovel(page);
  await page.goto('/novel.html?id=354');

  await expect(page.locator('body')).toHaveClass(/nl-work-detail-v2/u);
  await expect(page.locator('.nl-work-detail-main > .title')).toBeVisible();
  await expect(page.locator('.nl-work-detail-main > .title')).toHaveText(
    '学園で見つけた新しい勝ち方'
  );
  await expect(page.locator('.nl-work-detail-main > .author')).toContainText(
    'テスト作者'
  );
  await expect(page.locator('.nl-work-detail-left .tags')).toContainText(
    '現代ファンタジー'
  );
  await expect(page.locator('.nl-work-detail-bookmeta')).toBeVisible();
  await expect(
    page.locator('.nl-work-detail-synopsis .novelight-native-synopsis')
  ).toBeVisible();
  await expect(
    page.locator('.nl-work-detail-synopsis .novelight-native-synopsis-preview')
  ).toContainText('主人公が魔術学園で');

  const disclosure = page.locator(
    '.nl-work-detail-synopsis .novelight-native-synopsis'
  );
  await expect(disclosure).not.toHaveAttribute('open');
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open');
  await expect(disclosure.locator('.description')).toBeVisible();
  await expect(disclosure.locator('.description')).toHaveText(synopsis);
});
