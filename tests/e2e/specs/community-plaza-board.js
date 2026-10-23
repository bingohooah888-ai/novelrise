// Synthetic, browser-only Phase 2 acceptance. No hosted Supabase traffic.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const THREAD_ID = 'c0a00000-0000-4000-8000-000000000123';
const REPLY_ID = 'c0a00000-0000-4000-8000-000000000124';

function installFakeSupabase(seeded) {
  const id = 'c0a00000-0000-4000-8000-000000000123';
  const replyId = 'c0a00000-0000-4000-8000-000000000124';
  let thread = seeded
    ? {
        id,
        category: 'stories',
        title: '試験用の作品相談',
        body: '初期状態の本文',
        author_name: 'テスト投稿者',
        author_user_id: 'c0a00000-0000-4000-8000-000000000002',
        created_at: '2026-10-14T09:00:00Z',
        is_mine: true
      }
    : null;
  const replies = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'c0a00000-0000-4000-8000-000000000002' } } },
        error: null
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } }
      })
    },
    rpc: async (name, args = {}) => {
      window.__boardCalls.push(name);
      const okay = data => ({ data, error: null });
      if (name === 'novelight_community_board_list') {
        return okay(thread && (!args.p_category || args.p_category === thread.category)
          ? [{ ...thread, excerpt: thread.body, reply_count: replies.length }]
          : []);
      }
      if (name === 'novelight_community_board_detail') {
        return okay(thread && args.p_thread_id === id
          ? { ...thread, post_key: 'board:' + id }
          : null);
      }
      if (name === 'novelight_community_board_save') {
        thread = {
          ...thread,
          id,
          category: args.p_category,
          title: args.p_title,
          body: args.p_body,
          author_name: 'テスト投稿者',
          author_user_id: 'c0a00000-0000-4000-8000-000000000002',
          is_mine: true,
          created_at: '2026-10-14T09:00:00Z'
        };
        return okay(id);
      }
      if (name === 'novelight_community_board_delete') {
        thread = null;
        return okay(true);
      }
      if (name === 'novelight_community_comments') {
        return okay(args.p_post_key?.startsWith('board:') ? replies : []);
      }
      if (name === 'novelight_community_post_comment') {
        replies.push({
          id: replyId,
          body: args.p_body,
          display_name: 'テスト読者',
          created_at: '2026-10-14T10:00:00Z',
          is_mine: true,
          parent_comment_id: args.p_parent_comment_id
        });
        return okay({ id: replyId });
      }
      if (name === 'novelight_community_edit_my_comment') {
        const reply = replies.find(r => r.id === args.p_comment_id);
        if (reply) reply.body = args.p_body;
        return okay(true);
      }
      if (name === 'novelight_community_delete_my_comment') {
        replies.splice(0, replies.length);
        return okay(true);
      }
      if (name === 'novelight_community_my_notifications') return okay([]);
      if (name === 'novelight_community_feed') return okay([]);
      return okay([]);
    }
  };
  window.supabase = { createClient: () => client };
}

async function installBoardMock(page, enabled, seeded = false) {
  await page.addInitScript(() => {
    window.__boardCalls = [];
    window.__boardTestXssExecuted = false;
  });
  await page.route('**/*.supabase.co/**', route =>
    route.abort('blockedbyclient')
  );
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '(' + installFakeSupabase.toString() + ')(' + Boolean(seeded) + ');'
    });
  });
  await page.route('**/novelight-client.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (!/timeline: false,/.test(source) || !/board: false/.test(source)) {
      throw new Error('Release flags changed; mock refuses to run');
    }
    await route.fulfill({
      response,
      body: source
        .replace('timeline: false,', enabled ? 'timeline: true,' : 'timeline: false,')
        .replace('board: false', enabled ? 'board: true' : 'board: false')
    });
  });
}

test('board remains closed with joint release flags disabled', async ({ page }) => {
  await installBoardMock(page, false);
  await page.goto('/community.html#board', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityPending')).toBeVisible();
  await expect(page.locator('#communityTabs')).toBeHidden();
  await expect(page.locator('#communityBoardInfo')).toBeHidden();
  const calls = await page.evaluate(() => window.__boardCalls);
  expect(calls.some(name => name.includes('community_board'))).toBe(false);
});

test('board create, reply, owner edit and soft delete use isolated RPCs', async ({
  page
}) => {
  await installBoardMock(page, true);
  await page.goto('/community.html#board', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityBoardInfo')).toBeVisible();

  await page.locator('#boardComposeOpen').click();
  await page.locator('#boardComposeCategory').selectOption('stories');
  await page.locator('#boardComposeTitle').fill('新しい物語について');
  await page.locator('#boardComposeBody').fill('最初の投稿本文');
  await page.locator('#boardComposeSafety').check();
  await page.locator('#boardComposeSave').click();

  await expect(page.locator('#boardThreadDetail')).toBeVisible();
  await expect(page.locator('#boardDetailTitle')).toHaveText('新しい物語について');
  await expect(page).toHaveURL(new RegExp('board-thread-' + THREAD_ID));

  await page.locator('#boardReplyBody').fill('これがテスト返信です');
  await page.locator('#boardReplySend').click();
  await expect(page.locator('#boardReplyList .board-reply')).toContainText(
    'これがテスト返信です'
  );

  await page.locator('#boardDetailActions').getByRole('button', {
    name: '編集する'
  }).click();
  await page.locator('#boardComposeCategory').selectOption('writing');
  await page.locator('#boardComposeTitle').fill('編集後のタイトル');
  await page.locator('#boardComposeBody').fill('編集後の本文');
  await page.locator('#boardComposeSafety').check();
  await page.locator('#boardComposeSave').click();
  await expect(page.locator('#boardDetailTitle')).toHaveText('編集後のタイトル');
  await expect(page.locator('#boardDetailBody')).toHaveText('編集後の本文');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#boardDetailActions').getByRole('button', {
    name: '削除する'
  }).click();
  await expect(page.locator('#boardThreadDetail')).toBeHidden();
  await expect(page.locator('#boardThreadList .board-thread-card')).toHaveCount(0);

  const calls = await page.evaluate(() => window.__boardCalls);
  for (const operation of [
    'novelight_community_board_list',
    'novelight_community_board_save',
    'novelight_community_board_detail',
    'novelight_community_post_comment',
    'novelight_community_board_delete'
  ]) {
    expect(calls).toContain(operation);
  }
});

test('board thread deep link is shareable and content is escaped', async ({
  page
}) => {
  await installBoardMock(page, true, true);
  await page.goto('/community.html#board-thread-' + THREAD_ID, {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.locator('#boardThreadDetail')).toBeVisible();
  await expect(page.locator('#boardDetailTitle')).toHaveText('試験用の作品相談');
  await expect(page).toHaveURL(new RegExp('board-thread-' + THREAD_ID));

  await page.locator('#boardDetailActions').getByRole('button', {
    name: '編集する'
  }).click();
  await page.locator('#boardComposeTitle').fill(
    '<img src=x onerror="window.__boardTestXssExecuted=true">'
  );
  await page.locator('#boardComposeSafety').check();
  await page.locator('#boardComposeSave').click();
  await expect(page.locator('#boardDetailTitle')).toContainText('<img');
  await expect(page.locator('#boardDetailTitle img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__boardTestXssExecuted)).toBe(false);
});
