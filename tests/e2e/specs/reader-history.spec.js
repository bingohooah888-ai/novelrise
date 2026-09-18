import { expect, test } from '../fixtures/diagnostic-fixture.js';

test('private reader stats render honest summary, genres, and first-read history', async ({
  page
}) => {
  await page.goto('/tests/e2e/fixtures/reader-history.html');

  await page.evaluate(async () => {
    globalThis.__READER_HISTORY_CALLS__ = [];

    const client = {
      rpc: async (name, args) => {
        globalThis.__READER_HISTORY_CALLS__.push({ name, args });
        return {
          data: {
            summary: {
              valid_read_episode_count: 12,
              valid_read_work_count: 5,
              first_valid_read_day_count: 4,
              completed_marked_work_count: 2
            },
            genres: [
              { genre: 'ファンタジー', work_count: 3 },
              { genre: 'ミステリー', work_count: 1 }
            ],
            history: [
              {
                novel_id: '701',
                novel_title: '光の物語',
                genre: 'ファンタジー',
                episode_id: '801',
                episode_number: 2,
                episode_title: '第二話',
                first_valid_read_at: '2026-09-18T03:00:00Z'
              }
            ],
            semantics: {
              history_kind: 'first_valid_read_per_episode',
              timezone: 'Asia/Tokyo',
              public_profile: false
            }
          },
          error: null
        };
      }
    };

    await globalThis.NovelightReadingHistory.mount({
      client,
      mount: globalThis.document.querySelector('#history'),
      limit: 50
    });
  });

  await expect(page.locator('.reading-history-privacy')).toContainText(
    'この記録は自分だけに表示されます'
  );

  const stats = page.locator('.reading-history-stat');
  await expect(stats).toHaveCount(4);
  await expect(stats.nth(0)).toContainText('12');
  await expect(stats.nth(1)).toContainText('5');
  await expect(stats.nth(2)).toContainText('4');
  await expect(stats.nth(3)).toContainText('2');

  await expect(
    page.locator('.reading-history-genre-row').first()
  ).toContainText('ファンタジー');
  await expect(
    page.locator('.reading-history-genre-row').first()
  ).toContainText('3作品');

  const history = page.locator('.reading-history-item').first();
  await expect(history).toContainText('光の物語');
  await expect(history).toContainText('第2話');
  await expect(history).toHaveAttribute('href', 'episode.html?id=801');

  await expect(page.locator('.reading-history-semantics')).toContainText(
    '初回の有効読書'
  );

  expect(
    await page.evaluate(() => globalThis.__READER_HISTORY_CALLS__)
  ).toEqual([
    {
      name: 'novelight_reader_history_stats',
      args: { p_limit: 50 }
    }
  ]);
});

test('missing Production RPC fails closed without raw-table fallback', async ({
  page
}) => {
  await page.goto('/tests/e2e/fixtures/reader-history.html');

  await page.evaluate(async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function'
        }
      })
    };

    await globalThis.NovelightReadingHistory.mount({
      client,
      mount: globalThis.document.querySelector('#history'),
      limit: 50
    });
  });

  await expect(page.locator('.reading-history-error')).toContainText(
    'データベース反映待ち'
  );
  await expect(page.locator('.reading-history-stat')).toHaveCount(0);
});
