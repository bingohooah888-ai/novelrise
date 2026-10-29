import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function mountComments(page, { session = null } = {}) {
  await page.goto('/tests/e2e/fixtures/comment-spoiler-display.html');

  await page.evaluate(
    async ({ session }) => {
      const calls = [];
      globalThis.__COMMENT_CALLS__ = calls;

      const client = {
        storage: {
          from: () => ({
            getPublicUrl: () => ({
              data: { publicUrl: '/assets/scout-badges/reader_read_005.png' }
            })
          })
        },
        rpc: async (name, args) => {
          calls.push({ name, args });

          if (name === 'novelight_novel_comment_reception_state') {
            return {
              data: { comments_enabled: true },
              error: null
            };
          }

          if (name === 'novelight_comment_feed') {
            return {
              data: [
                {
                  id: 'spoiler-1',
                  user_id: '11111111-1111-4111-8111-111111111111',
                  avatar_path:
                    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp',
                  scout_level: 10,
                  equipped_badge_id: 'reader_read_005',
                  equipped_badge_name: 'PAGEWALKER',
                  display_name: 'ネタバレ読者',
                  body: '犯人は庭師です。',
                  created_at: '2026-09-18T10:00:00Z',
                  can_delete: false,
                  can_moderate: false,
                  is_pinned: false,
                  is_hidden: false,
                  is_spoiler: true,
                  author_reply_body: 'そこに気づきましたか。',
                  author_reply_at: '2026-09-18T10:05:00Z'
                },
                {
                  id: 'plain-1',
                  user_id: 'reader-2',
                  display_name: '通常読者',
                  body: '世界観が好きです。',
                  created_at: '2026-09-18T09:00:00Z',
                  can_delete: false,
                  can_moderate: false,
                  is_pinned: false,
                  is_hidden: false,
                  is_spoiler: false,
                  author_reply_body: null
                }
              ],
              error: null
            };
          }

          if (name === 'novelight_post_novel_comment') {
            return {
              data: { id: 'posted-1', is_spoiler: args.p_is_spoiler === true },
              error: null
            };
          }

          return { data: true, error: null };
        }
      };

      await globalThis.NovelightComments.mount({
        client,
        novel: { id: '799001' },
        session,
        isAuthor: false
      });
    },
    { session }
  );
}

test('spoiler comment body and author reply stay hidden until explicit reveal', async ({
  page
}) => {
  await mountComments(page);

  const spoiler = page.locator('.novelight-comment').filter({
    hasText: 'ネタバレ読者'
  });
  const toggle = spoiler.locator('.novelight-comment-spoiler-toggle');
  const content = spoiler.locator('.novelight-comment-spoiler-content');

  await expect(
    spoiler.locator('.novelight-comment-badge.is-spoiler')
  ).toHaveText('ネタバレ');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText('ネタバレを表示');
  await expect(content).toBeHidden();
  await expect(content).toContainText('犯人は庭師です。');
  await expect(content).toContainText('そこに気づきましたか。');

  const plain = page.locator('.novelight-comment').filter({
    hasText: '通常読者'
  });
  await expect(plain.locator('.novelight-comment-body')).toBeVisible();
  await expect(plain).toContainText('世界観が好きです。');

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('ネタバレを隠す');
  await expect(content).toBeVisible();

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toBeHidden();
});

test('composer submits the reader-selected spoiler flag through the B #15 RPC', async ({
  page
}) => {
  await mountComments(page, {
    session: { user: { id: 'reader-e2e' } }
  });

  const textarea = page.locator('#novelight-comment-body');
  const spoilerCheckbox = page.locator(
    '.novelight-comments-spoiler-option input[name="spoiler"]'
  );

  await textarea.fill('結末についての感想です。');
  await spoilerCheckbox.check();
  await page.locator('.novelight-comments-submit').click();

  await expect(page.locator('.novelight-comments-status')).toHaveText(
    'コメントを投稿しました。'
  );
  await expect(textarea).toHaveValue('');
  await expect(spoilerCheckbox).not.toBeChecked();

  const calls = await page.evaluate(() => globalThis.__COMMENT_CALLS__);
  const post = calls.find(
    (call) => call.name === 'novelight_post_novel_comment'
  );

  expect(post).toEqual({
    name: 'novelight_post_novel_comment',
    args: {
      p_novel_id: '799001',
      p_body: '結末についての感想です。',
      p_is_spoiler: true
    }
  });
});

test('public comment identity is displayed above the pen name', async ({
  page
}) => {
  await mountComments(page);
  const comment = page.locator('.novelight-comment').filter({
    hasText: 'ネタバレ読者'
  });
  const profile = comment.locator('.novelight-comment-profile');
  const avatarImage = profile.locator('.novelight-comment-avatar img');
  await expect(avatarImage).toHaveAttribute(
    'src',
    '/assets/scout-badges/reader_read_005.png'
  );
  const width = await avatarImage.evaluate((image) => image.naturalWidth);
  expect(width).toBeGreaterThan(0);
  await expect(profile.locator('.novelight-comment-level')).toHaveText(
    'SCOUT Lv.10'
  );
  await expect(profile.locator('.novelight-comment-equipped-name')).toHaveText(
    'PAGEWALKER'
  );
  await expect(
    profile.locator('.novelight-comment-equipped-image img')
  ).toHaveAttribute('src', 'assets/scout-badges/reader_read_005.png');

  expect(
    await profile.evaluate((element) => {
      return Boolean(
        element.compareDocumentPosition(
          element.parentElement.querySelector('.novelight-comment-identity')
        ) & 4
      );
    })
  ).toBe(true);

  const unconfigured = page.locator('.novelight-comment').filter({
    hasText: '通常読者'
  });
  await expect(
    unconfigured.locator('.novelight-comment-avatar')
  ).toHaveText('通');
  await expect(unconfigured.locator('.novelight-comment-level')).toHaveCount(0);
  await expect(unconfigured.locator('.novelight-comment-equipped')).toHaveCount(
    0
  );
});
