import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function mountComments(page, { session = null } = {}) {
  await page.goto('/tests/e2e/fixtures/comment-spoiler-display.html');

  await page.evaluate(
    async ({ session }) => {
      const calls = [];
      globalThis.__COMMENT_CALLS__ = calls;

      const client = {
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
                  user_id: 'reader-1',
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
