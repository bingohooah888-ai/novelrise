import { expect, test } from '../fixtures/diagnostic-fixture.js';

const SAMPLE_SYNOPSIS =
  'かつて天才だった少年が新しい勝ち方を見つけていく。'.repeat(24);

test('novel owner sees title, synopsis, LIGHT SEED and received-seed panel', async ({
  page
}) => {
  await page.addInitScript((synopsis) => {
    globalThis.__NOVEL_DETAIL_TEST_SYNOPSIS__ = synopsis;
  }, SAMPLE_SYNOPSIS);
  // Diagnostic-only observer guard to identify an event-loop mutation storm.
  // On runaway callbacks, disconnect the specific observer and record its origin.
  await page.addInitScript(() => {
    const NativeObserver = globalThis.MutationObserver;
    let observerId = 0;
    globalThis.MutationObserver = class DiagnosticMutationObserver extends NativeObserver {
      constructor(callback) {
        const id = ++observerId;
        const origin = (new Error().stack || 'unknown').slice(0, 1200);
        let callbacks = 0;
        super((records, observer) => {
          callbacks += 1;
          if (callbacks === 150) console.error('[NOVELIGHT_DIAG] observer 150 callbacks', id, origin);
          if (callbacks === 600) {
            console.error('[NOVELIGHT_DIAG] disconnecting runaway observer', id, origin);
            observer.disconnect();
            return;
          }
          callback(records, observer);
        });
      }
    };
  });
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
            ai_usage: 'human', content_rating: 'general', content_warnings: [],
            created_at: '2026-09-28T00:00:00Z', show_episode_numbers: true,
            thumbnail_url: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22150%22%3E%3Crect%20width=%22100%22%20height=%22150%22%20fill=%22teal%22/%3E%3C/svg%3E'
          };
          function builder(table) {
            let selected = '';
            // Match actual Supabase behavior: unselected fields aren't returned.
            const projected = () => Object.fromEntries(
              selected.split(',').map((key) => key.trim())
                .filter((key) => Object.prototype.hasOwnProperty.call(novel, key))
                .map((key) => [key, novel[key]])
            );
            const api = {
              select(fields) { selected = fields; return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              range() { return api; },
              maybeSingle: async () => ({
                data: table === 'novels' ? projected() : null, error: null
              }),
              single: async () => ({
                data: table === 'novels' ? projected() : null,
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
            rpc: async (name) => {
              // Delayed outline reproduces the real loading-placeholder race.
              if (name === 'novelight_novel_outline') {
                await new Promise((resolve) => setTimeout(resolve, 650));
              }
              return {
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
              };
            },
            from: (table) => builder(table)
          };
          window.supabase = { createClient: () => client };
        })();
      `
    });
  });

  await page.goto('/novel.html?id=354', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.nl-work-detail-grid')).toBeVisible();
  await expect(page.locator('.nl-work-detail-cover img')).toBeVisible();
  await expect(page.locator('.nl-work-detail-cover img')).toHaveJSProperty(
    'naturalWidth',
    100
  );
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
  await expect(page.locator('.nl-work-author-episodes')).toHaveText(
    '公開1話・下書き1話'
  );
  // Updating identical textContent was recreating a text node on every
  // animation frame, waking the page-wide MutationObserver indefinitely.
  const redundantMutations = await page.evaluate(async () => {
    const target = globalThis.document.querySelector(
      '.nl-work-author-episodes'
    );
    let mutations = 0;
    const observer = new globalThis.MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(target, { childList: true, subtree: true });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    observer.disconnect();
    return mutations;
  });
  expect(redundantMutations).toBe(0);
});
