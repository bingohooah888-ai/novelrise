// Local browser proof only: synthetic activity, mocked Supabase, no hosted DB traffic.
// This is not a Production or hosted Staging acceptance test.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const FIXTURE = {
  post_key: 'note:42',
  kind: 'note',
  title: 'テスト用の近況',
  body: '交流広場の安全な画面表示をテストしています。'.repeat(9),
  author_name: 'テスト作者',
  author_user_id: 'c0a00000-0000-4000-8000-000000000001',
  occurred_at: '2026-10-14T09:00:00Z',
  like_count: 1,
  comment_count: 1,
  liked_by_me: false
};

function initializeCommunityMock(delayFeed) {
  globalThis.__communityTestCalls = [];
  globalThis.__communityTestFeedFilters = [];
  globalThis.__communityDelayFirstFeed = delayFeed;
}

// Keep the injected Playwright fixture verbatim; it is intentionally test-only.
// prettier-ignore
async function installIsolatedMock(page, enabled, options = {}) {
  const delayFirstFeed = options.delayFirstFeed === true;
  // Fulfill the vendor library locally so the hard-coded Production URL
  // is never sent to the network; record any unexpected RPC names.
  await page.addInitScript(initializeCommunityMock, delayFirstFeed);
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
              const feed = ${JSON.stringify(FIXTURE)};
          const client = {
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'c0a00000-0000-4000-8000-000000000002' } } },
                error: null
              }),
              getUser: async () => ({data: {user: {id: 'c0a00000-0000-4000-8000-000000000002'}}, error: null}),
              onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}})
            },
            rpc: async (name, payload = {}) => {
              globalThis.__communityTestCalls.push(name);
              if (name === 'novelight_community_feed') {
                globalThis.__communityTestFeedFilters.push(Boolean(payload.p_following));
                if (globalThis.__communityDelayFirstFeed) {
                  globalThis.__communityDelayFirstFeed = false;
                  return new Promise((resolve) => {
                    globalThis.__communityReleaseFirstFeed = () => {
                      resolve({data: [feed], error: null});
                    };
                  });
                }
                return {data: payload.p_following ? [] : [feed], error:null};
              }
              if (name === 'novelight_author_follow_state') {
                return {data: {following: false, notify_new_works: true, notify_updates: true}, error:null};
              }
              if (name === 'novelight_set_author_follow') {
                return {data: {following: payload.p_following, notify_new_works: true, notify_updates: true}, error:null};
              }
              if (name === 'novelight_set_author_follow_notifications') {
                return {data: {following: true, notify_new_works: payload.p_notify_new_works, notify_updates: payload.p_notify_updates}, error:null};
              }
              if (name === 'novelight_community_toggle_like') {
                return {data: {liked: true, like_count: 2}, error:null};
              }
              if (name === 'novelight_community_comments') {
                return {data: [{id:'c0a00000-0000-4000-8000-000000000012',body:'既存コメント',display_name:'読者A',is_mine:true}],error:null};
              }
              if (name === 'novelight_community_post_comment') {
                return {data: {id:'c0a00000-0000-4000-8000-000000000013'},error:null};
              }
              if (name === 'novelight_community_edit_my_comment') return {data:true,error:null};
              if (name === 'novelight_community_report') return {data: true,error:null};
              if (name === 'novelight_community_my_notifications') return {data: [],error:null};
              return {data: [],error:null};
            },
            from: () => {
              const builder = new Proxy({}, {
                get(_, key) {
                  if (key === 'then') {
                    return (resolve) => Promise.resolve({data:[],error:null,count:0}).then(resolve);
                  }
                  return () => builder;
                }
              });
              return builder;
            }
          };
          window.supabase = {createClient: () => client};
        })();
      `
    });
  });
  if (enabled) {
    await page.route('**/novelight-client.js', async (route) => {
      const response = await route.fetch();
      const original = await response.text();
      const marker = 'timeline: false,';
      if (!original.includes(marker)) {
        throw new Error(
          'Preview-only fixture could not find the exact release flag'
        );
      }
      await route.fulfill({
        response,
        body: original.replace(marker, 'timeline: true,')
      });
    });
  }
}

// prettier-ignore
test('latest filter wins during pending feed request', async ({ page }) => {
  await installIsolatedMock(page, true, { delayFirstFeed: true });
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const firstFeedReady = () =>
    page.evaluate(() => typeof globalThis.__communityReleaseFirstFeed);
  await expect.poll(firstFeedReady).toBe('function');

  const followingTab = page.locator('[data-community-filter="following"]');
  await followingTab.click();
  await expect(followingTab).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => globalThis.__communityReleaseFirstFeed());

  const requestedFilters = () =>
    page.evaluate(() => globalThis.__communityTestFeedFilters);
  await expect.poll(requestedFilters).toEqual([false, true]);
  await expect(page.locator('.community-card')).toHaveCount(0);
  await expect(page.locator('#communityPageFeed .community-state')).toContainText(
    'まだ公開中の交流はありません'
  );
});

test('community gate OFF prevents RPC calls', async ({ page }) => {
  await installIsolatedMock(page, false);
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.community-card')).toHaveCount(0);
  const calls = await page.evaluate(() => globalThis.__communityTestCalls);
  expect(
    calls.filter((name) => name.startsWith('novelight_community_'))
  ).toEqual([]);
});

// prettier-ignore
test('community UI interactions use mocked data', async ({ page }) => {
  await installIsolatedMock(page, true);
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.community-card');
  await expect(card).toHaveCount(1);
  await expect(page.locator('#communityPageHeading')).toBeVisible();
  await expect(page.locator('.community-tabs')).toBeVisible();
  await expect(card.locator('.community-card-title')).toHaveText(
    'テスト用の近況'
  );
  await expect(card.locator('.community-card-body')).toContainText(
    '安全な画面表示'
  );
  await card.locator('.community-expand').click();
  await expect(card.locator('.community-expand')).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  await card.locator('.community-follow-open').click();
  const follow = card.locator('.community-follow-toggle');
  await expect(follow).toHaveText('フォローする');
  await follow.click();
  await expect(follow).toHaveText('フォローを解除');
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await card.locator('.community-follow-choice input').first().uncheck();
  await expect(card.locator('.community-follow-status')).toContainText(
    '通知設定を保存しました'
  );
  const like = card.locator('[aria-label="いいね"]');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toContainText('2');

  await card.locator('.community-action', { hasText: 'コメント' }).click();
  await expect(card.locator('.community-comment')).toContainText(
    '既存コメント'
  );
  await card.locator('.community-comment .community-action', { hasText: /^編集$/ }).click();
  await card.locator('.community-comment-edit textarea').fill('修正したコメント');
  await card.locator('.community-comment-edit button[type="submit"]').click();
  await expect(card.locator('.community-comment')).toContainText('修正したコメント');
  const editor = card.locator('.community-comment-form textarea');
  await editor.fill('テストの返信です\n2行目です');
  await expect(card.locator('.community-comment-counter')).toContainText('残り');
  await card.locator('.community-comments-refresh').click();
  await expect(card.locator('.community-comment-form textarea')).toHaveValue(
    'テストの返信です\n2行目です'
  );
  await card.locator('.community-comment-form button[type="submit"]').click();
  // Desktop and Pixel-sized mobile must keep the interactive card within the
  // viewport, including the expanded comments/form state.
  const layout = await page.evaluate(() => ({
    clientWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  await card
    .locator('.community-actions button', { hasText: /^通報$/ })
    .click();
  await expect(card.locator('.community-report-form')).toBeVisible();
  await card.locator('.community-report-form textarea').fill('テスト理由');
  await card.locator('.community-report-form .community-report-submit').click();
  await expect(card.locator('.community-report-form')).toBeHidden();
  await expect(
    card.locator('.community-actions button', { hasText: /^通報済み$/ })
  ).toBeDisabled();

  await page.locator('[data-community-filter="following"]').click();
  await expect(page.locator('.community-card')).toHaveCount(0);
  await expect(
    page.locator('#communityPageFeed .community-state')
  ).toContainText('まだ公開中の交流はありません');

  await page.locator('#communityBoardTab').click();
  await expect(page.locator('#communityBoardInfo')).toBeVisible();
  await expect(page.locator('#communityTimeline')).toBeHidden();
  const calls = await page.evaluate(() => globalThis.__communityTestCalls);
  for (const operation of [
    'novelight_community_feed',
    'novelight_community_toggle_like',
    'novelight_community_comments',
    'novelight_community_post_comment',
    'novelight_community_report'
  ]) {
    expect(calls).toContain(operation);
  }
});
