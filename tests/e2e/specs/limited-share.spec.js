import { expect, test } from '../fixtures/diagnostic-fixture.js';

const token = 'a'.repeat(64);

test('author manager generates fragment-only share URL and can revoke it', async ({
  page
}) => {
  await page.goto('/tests/e2e/fixtures/limited-share.html');

  await page.evaluate(
    async ({ token }) => {
      let enabled = false;
      globalThis.__LIMITED_SHARE_CALLS__ = [];

      const client = {
        from: () => ({
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: {
              id: 798001,
              title: '共有テスト作品',
              status: 'draft',
              user_id: 'author-1'
            },
            error: null
          })
        }),
        rpc: async (name, args) => {
          globalThis.__LIMITED_SHARE_CALLS__.push({ name, args });

          if (name === 'novelight_share_link_status') {
            return {
              data: {
                eligible: true,
                enabled,
                created_at: enabled ? '2026-09-18T13:00:00Z' : null,
                rotated_at: enabled ? '2026-09-18T13:00:00Z' : null
              },
              error: null
            };
          }

          if (name === 'novelight_rotate_share_link') {
            enabled = true;
            return {
              data: {
                token,
                created_at: '2026-09-18T13:00:00Z',
                rotated_at: '2026-09-18T13:00:00Z'
              },
              error: null
            };
          }

          if (name === 'novelight_revoke_share_link') {
            enabled = false;
            return { data: true, error: null };
          }

          return { data: null, error: { code: '42883' } };
        }
      };

      await globalThis.NovelightLimitedShare.mountManager({
        client,
        novelId: 798001,
        session: { user: { id: 'author-1' } },
        mount: globalThis.document.querySelector('#manager')
      });
    },
    { token }
  );

  await expect(page.locator('.limited-share-badge')).toHaveText('共有停止中');
  await page.locator('.limited-share-primary').click();

  const input = page.locator('.limited-share-url');
  await expect(input).toBeVisible();
  const shareUrl = await input.inputValue();
  expect(shareUrl).toContain('/shared.html#token=' + token);
  expect(shareUrl).not.toContain('?token=');

  await expect(page.locator('.limited-share-badge')).toHaveText('限定共有中');
  await page.locator('.limited-share-actions .limited-share-secondary').click();
  await expect(page.locator('.limited-share-badge')).toHaveText('共有停止中');

  const calls = await page.evaluate(() => globalThis.__LIMITED_SHARE_CALLS__);
  expect(calls.map((call) => call.name)).toContain(
    'novelight_rotate_share_link'
  );
  expect(calls.map((call) => call.name)).toContain(
    'novelight_revoke_share_link'
  );
});

test('reader renders only token-bound draft payload without normal engagement UI', async ({
  page
}) => {
  await page.goto('/tests/e2e/fixtures/limited-share.html');

  await page.evaluate(
    async ({ token }) => {
      globalThis.__LIMITED_SHARE_CALLS__ = [];

      const client = {
        rpc: async (name, args) => {
          globalThis.__LIMITED_SHARE_CALLS__.push({ name, args });

          if (name === 'novelight_shared_novel') {
            return {
              data: {
                title: '共有テスト作品',
                description: '限定共有の説明',
                genre: 'ファンタジー',
                content_rating: 'general',
                content_warnings: [],
                author_name: '作者A',
                episodes: [
                  { episode_number: 1, title: '第一話' },
                  { episode_number: 2, title: '第二話' }
                ]
              },
              error: null
            };
          }

          if (name === 'novelight_shared_episode') {
            return {
              data: {
                novel_title: '共有テスト作品',
                episode_number: 1,
                title: '第一話',
                content: '限定共有だけで見える本文です。',
                previous_episode_number: null,
                next_episode_number: 2
              },
              error: null
            };
          }

          return { data: null, error: { code: '42883' } };
        }
      };

      await globalThis.NovelightLimitedShare.mountReader({
        client,
        token,
        episodeNumber: 1,
        mount: globalThis.document.querySelector('#reader')
      });
    },
    { token }
  );

  await expect(
    page.locator('#reader .limited-share-reader-eyebrow')
  ).toHaveText('限定共有・下書き確認');
  await expect(
    page.locator('#reader .limited-share-episode-content')
  ).toHaveText('限定共有だけで見える本文です。');
  await expect(
    page.locator('#reader .limited-share-reader-neutral')
  ).toContainText('PV・お気に入り・LIGHT SEED・SCOUT・Rank');
  await expect(page.locator('#reader')).not.toContainText('コメントを投稿');
  await expect(page.locator('#reader')).not.toContainText('お気に入りに追加');

  const calls = await page.evaluate(() => globalThis.__LIMITED_SHARE_CALLS__);
  expect(calls.map((call) => call.name)).toEqual([
    'novelight_shared_novel',
    'novelight_shared_episode'
  ]);
});

test('invalid token fails closed before any RPC call', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/limited-share.html');

  await page.evaluate(async () => {
    globalThis.__LIMITED_SHARE_CALLS__ = [];
    const client = {
      rpc: async (name) => {
        globalThis.__LIMITED_SHARE_CALLS__.push(name);
        return { data: null, error: null };
      }
    };

    await globalThis.NovelightLimitedShare.mountReader({
      client,
      token: 'not-a-token',
      episodeNumber: null,
      mount: globalThis.document.querySelector('#reader')
    });
  });

  await expect(page.locator('#reader .limited-share-error')).toContainText(
    '共有リンクが正しくありません'
  );
  expect(await page.evaluate(() => globalThis.__LIMITED_SHARE_CALLS__)).toEqual(
    []
  );
});
