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
  author_avatar_path:
    'c0a00000-0000-4000-8000-000000000001/c0a00000-0000-4000-8000-000000000099.webp',
  occurred_at: '2026-10-14T09:00:00Z',
  like_count: 1,
  comment_count: 1,
  liked_by_me: false
};

function initializeCommunityMock(options) {
  globalThis.__communityTestCalls = [];
  globalThis.__communityWithoutAvatar = options.withoutAvatar === true;
  globalThis.__communityTestFeedFilters = [];
  globalThis.__communityDelayFirstFeed = options.delayFeed;
  globalThis.__communityTestReadAttempts = 0;
  globalThis.__communityTestNotifications = options.notifications
    ? [
        {
          id: 15,
          kind: 'reply',
          post_key: 'note:42',
          actor_name: 'テスト読者',
          comment_id: 'c0a00000-0000-4000-8000-000000000012',
          created_at: '2026-10-14T10:00:00Z',
          read_at: null
        }
      ]
    : [];
  globalThis.__communityRejectNextCommentReceipt = false;
}

// Keep the injected Playwright fixture verbatim; it is intentionally test-only.
// prettier-ignore
async function installIsolatedMock(page, enabled, options = {}) {
  const delayFirstFeed = options.delayFirstFeed === true;
  const tinyAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="15" fill="gold"/></svg>');
  // Fulfill the vendor library locally so the hard-coded Production URL
  // is never sent to the network; record any unexpected RPC names.
  await page.addInitScript(initializeCommunityMock, {
    delayFeed: delayFirstFeed,
    notifications: options.notifications === true,
    withoutAvatar: options.withoutAvatar === true
  });
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  // The shared avatar renderer now builds storage URLs directly. Mock only
  // the synthetic avatar asset while all other Supabase traffic stays blocked.
  await page.route('**/storage/v1/object/public/author-avatars/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: decodeURIComponent(tinyAvatar.split(',')[1])
    })
  );
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
              const originalFeed = ${JSON.stringify(FIXTURE)};
              const feed = globalThis.__communityWithoutAvatar
                ? {...originalFeed, author_avatar_path:null} : originalFeed;
          const client = {
            supabaseUrl: 'https://mock-author-profile.supabase.co',
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'c0a00000-0000-4000-8000-000000000002' } } },
                error: null
              }),
              getUser: async () => ({data: {user: {id: 'c0a00000-0000-4000-8000-000000000002'}}, error: null}),
              onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}})
            },
            storage: {from: (bucket) => ({
              getPublicUrl: () => ({data: {publicUrl: bucket === 'author-avatars' ? ${JSON.stringify(tinyAvatar)} : null}})
            })},
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
                return {data: [feed], error:null};
              }
              if (name === 'novelight_public_profile') return {data: {display_name: 'テスト作者', bio: ''}, error: null};
              if (name === 'novelight_public_author_avatar') return {data: globalThis.__communityWithoutAvatar ? null : originalFeed.author_avatar_path, error: null};
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
                return {data: [{id:'c0a00000-0000-4000-8000-000000000012',body:'既存コメント',display_name:'読者A',created_at:'2026-10-14T10:15:00Z',is_mine:true}],error:null};
              }
              if (name === 'novelight_community_post_comment') {
                if (globalThis.__communityRejectNextCommentReceipt) {
                  globalThis.__communityRejectNextCommentReceipt = false;
                  return {data: {id: 'not-a-comment-id'},error:null};
                }
                return {data: {id:'c0a00000-0000-4000-8000-000000000013'},error:null};
              }
              if (name === 'novelight_community_edit_my_comment') return {data:true,error:null};
              if (name === 'novelight_community_comment_detail') {
                return {data: {id:payload.p_comment_id,body:'過去のコメント本文',display_name:'前の読者',created_at:'2026-10-10T09:00:00Z'},error:null};
              }
              if (name === 'novelight_community_report') return {data: true,error:null};
              if (name === 'novelight_community_my_notifications') {
                return {data: globalThis.__communityTestNotifications,error:null};
              }
              if (name === 'novelight_community_mark_notifications_read') {
                globalThis.__communityTestReadAttempts += 1;
                return {data: globalThis.__communityTestReadAttempts === 1 ? 0
                  : payload.p_ids.length,error:null};
              }
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
  await page.route('**/novelight-client.js', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const marker = /timeline: (?:false|true),/;
    if (!marker.test(original)) {
      throw new Error(
        'Isolated mock could not find the exact community release flag'
      );
    }
    await route.fulfill({
      response,
      body: original
        .replace(marker, enabled ? 'timeline: true,' : 'timeline: false,')
        .replace(
          /board:\s*(?:false|true)(?=\s*[,}])/,
          enabled ? 'board: true' : 'board: false'
        )
    });
  });
}

// The same uploaded public icon is shown on both community surfaces and author profiles.
// prettier-ignore
test('profile icon appears in Home, plaza and public author page', async ({ page }) => {
  await installIsolatedMock(page, true);
  for (const path of ['/index.html', '/community.html']) {
    await page.goto(path, {waitUntil:'domcontentloaded'});
    const card = page.locator('.community-card').first();
    await expect(card.locator('.community-avatar img')).toBeVisible();
  }
  await page.goto('/author.html?id=c0a00000-0000-4000-8000-000000000001', {waitUntil:'domcontentloaded'});
  await expect(page.locator('.profile .public-author-avatar img')).toBeVisible();
});

// prettier-ignore
test('avatarless profile falls back to name initials', async ({ page }) => {
  await installIsolatedMock(page, true, {withoutAvatar:true});
  await page.goto('/community.html', {waitUntil:'domcontentloaded'});
  const avatar = page.locator('.community-card .community-avatar').first();
  await expect(avatar).toHaveText('テ');
  await expect(avatar.locator('img')).toHaveCount(0);
});

// prettier-ignore
test('latest refresh wins during pending feed request', async ({ page }) => {
  await installIsolatedMock(page, true, { delayFirstFeed: true });
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const firstFeedReady = () =>
    page.evaluate(() => typeof globalThis.__communityReleaseFirstFeed);
  await expect.poll(firstFeedReady).toBe('function');

  // Refresh is disabled while an RPC is pending; dispatch to prove the
  // in-flight reset queue still accepts a programmatic refresh event.
  await page.locator('#communityRefresh').dispatchEvent('click');
  await page.evaluate(() => globalThis.__communityReleaseFirstFeed());

  const requestedFilters = () =>
    page.evaluate(() => globalThis.__communityTestFeedFilters);
  await expect.poll(requestedFilters).toEqual([false, false]);
  await expect(page.locator('.community-card')).toHaveCount(1);
  await expect(page.locator('.community-card-title')).toContainText(
    'テスト用の近況'
  );
});

test('incomplete notice-read receipt never clears unread state', async ({
  page
}) => {
  await installIsolatedMock(page, true, { notifications: true });
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const notices = page.locator('#communityNotifications');
  await expect(notices).toBeVisible();
  const row = notices.locator('.community-notice-list li');
  const mark = notices.locator('.community-notice-mark');
  await expect(row).toHaveClass(/community-notice-unread/);
  await mark.click();
  await expect(notices.locator('.community-notice-feedback')).toContainText(
    '既読にできませんでした'
  );
  await expect(row).toHaveClass(/community-notice-unread/);
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(row).toHaveClass(/community-notice-read/);
  await expect(notices.locator('.community-notice-count')).toContainText(
    '表示中の通知は確認済みです'
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

// Browser-level parity: static markup equality alone cannot enforce button
// dimensions when a light page accidentally skips its header stylesheet.
// prettier-ignore
test('signed-in Studio button has Home-scale dimensions on the plaza', async ({ page }) => {
  await installIsolatedMock(page, true);
  const studioMetrics = async () => {
    const link = page.locator('header.site-header .login-action');
    await expect(link).toHaveText('創作室');
    return link.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const computed = globalThis.getComputedStyle(el);
      return { height: box.height, font: parseFloat(computed.fontSize) };
    });
  };
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  const home = await studioMetrics();
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const plaza = await studioMetrics();
  expect(plaza.height).toBeLessThanOrEqual(home.height + 2);
  expect(plaza.font).toBeLessThanOrEqual(home.font + 1);
});

// The same mock post must have identical computed styles and controls in both views.
// prettier-ignore
test('Home and plaza share exact timeline card appearance and actions', async ({ page }) => {
  await installIsolatedMock(page, true);
  async function appearance(path, selector) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const card = page.locator(selector).first();
    await expect(card).toBeVisible();
    return card.evaluate((element) => {
      const style = globalThis.getComputedStyle;
      const get = (selector) => element.querySelector(selector);
      const report = get('.community-post-meta > button');
      const actionRow = get('.community-actions');
      return {
        stylesheetCount: globalThis.document.querySelectorAll('link[data-novelight-community-card="shared"]').length,
        background: style(element).backgroundColor,
        titleColor: style(get('.community-card-title')).color,
        bodyColor: style(get('.community-card-body')).color,
        authorSize: parseFloat(style(get('.community-person')).fontSize),
        titleSize: parseFloat(style(get('.community-card-title')).fontSize),
        bodySize: parseFloat(style(get('.community-card-body')).fontSize),
        dateSize: parseFloat(style(get('.community-date')).fontSize),
        reportSize: parseFloat(style(report).fontSize),
        actionRowDisplay: style(actionRow).display,
        reportParent: report.parentElement.className,
        reportLabel: report.textContent,
        metaContainsDate: Boolean(get('.community-post-meta .community-date'))
      };
    });
  }
  const home = await appearance('/index.html', '#communityHomeFeed .community-card');
  const plaza = await appearance('/community.html', '#communityPageFeed .community-card');
  expect(home).toEqual(plaza);
  expect(home).toMatchObject({
    stylesheetCount: 1,
    background: 'rgb(16, 32, 53)',
    titleColor: 'rgb(245, 242, 234)',
    bodyColor: 'rgb(218, 226, 236)',
    authorSize: 19,
    titleSize: 22,
    dateSize: 17,
    reportSize: 17,
    actionRowDisplay: 'none',
    reportParent: 'community-post-meta',
    reportLabel: '通報',
    metaContainsDate: true
  });
  expect(home.bodySize).toBe(
    await page.evaluate(() => globalThis.matchMedia('(max-width: 640px)').matches) ? 19 : 20
  );
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
  // Check the browser's computed style, not only the presence of a CSS token.
  // The previous ivory :is(#id, .card) rule outranked the navy override.
  const appearance = await card.evaluate((element) => {
    const style = globalThis.getComputedStyle;
    return {
      background: style(element).backgroundColor,
      title: style(element.querySelector('.community-card-title')).color,
      body: style(element.querySelector('.community-card-body')).color,
      fontSizes: {
        author: parseFloat(style(element.querySelector('.community-person')).fontSize),
        date: parseFloat(style(element.querySelector('.community-date')).fontSize),
        title: parseFloat(style(element.querySelector('.community-card-title')).fontSize),
        body: parseFloat(style(element.querySelector('.community-card-body')).fontSize),
        report: parseFloat(style(element.querySelector('.community-post-meta > .community-action')).fontSize)
      },
      mobile: globalThis.matchMedia('(max-width: 640px)').matches
    };
  });
  expect(appearance.background).toBe('rgb(16, 32, 53)');
  expect(appearance.title).toBe('rgb(245, 242, 234)');
  expect(appearance.body).toBe('rgb(218, 226, 236)');
  expect(appearance.fontSizes).toEqual({
    author: 19,
    date: 17,
    title: 22,
    body: appearance.mobile ? 19 : 20,
    report: 17
  });
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
  await expect(like).toBeHidden();
  await like.dispatchEvent('click');
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toContainText('2');

  const commentToggle = card.locator('.community-actions button', { hasText: /^コメント/ });
  await expect(commentToggle).toBeHidden();
  await expect(card.locator('.community-share')).toBeHidden();
  await commentToggle.dispatchEvent('click');
  await expect(card.locator('.community-comment')).toContainText(
    '既存コメント'
  );
  await card.locator('.community-comment .community-action', { hasText: /^編集$/ }).click();
  await card.locator('.community-comment-edit textarea').fill('修正した\nコメント');
  await card.locator('.community-comment-edit button[type="submit"]').click();
  await expect(card.locator('.community-comment-body')).toContainText('修正した');
  expect(
    await card.locator('.community-comment-body').evaluate(el => globalThis.getComputedStyle(el).whiteSpace)
  ).toBe('pre-wrap');
  await expect(card.locator('.community-comment-time')).toContainText('10/14');
  await card.locator('.community-comment-share').click();
  await expect(card.locator('.community-comment-share-status')).toContainText(
    /コメントのリンクをコピー|コメントへのリンク/
  );
  const editor = card.locator('.community-comment-form textarea');
  await editor.fill('テストの返信です\n2行目です');
  await expect(card.locator('.community-comment-counter')).toContainText('残り');
  await card.locator('.community-comments-refresh').click();
  await expect(card.locator('.community-comment-form textarea')).toHaveValue(
    'テストの返信です\n2行目です'
  );
  await page.evaluate(() => { globalThis.__communityRejectNextCommentReceipt = true; });
  await card.locator('.community-comment-form button[type="submit"]').click();
  await expect(card.locator('.community-comment-form .community-comment-feedback'))
    .toContainText('コメントを送信できませんでした');
  await expect(card.locator('.community-comment-form textarea')).toHaveValue(
    'テストの返信です\n2行目です'
  );
  await expect(card.locator('.community-actions button', {hasText:/^コメント/}))
    .toHaveText('コメント 1');
  await card.locator('.community-comment-form button[type="submit"]').click();
  await expect(card.locator('.community-actions button', {hasText:/^コメント/}))
    .toHaveText('コメント 2');
  // Desktop and Pixel-sized mobile must keep the interactive card within the
  // viewport, including the expanded comments/form state.
  const layout = await page.evaluate(() => ({
    clientWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  const report = card.locator('.community-post-meta > button');
  await expect(card.locator('.community-post-meta .community-date')).toBeVisible();
  await expect(report).toHaveText('通報');
  await expect(report).toBeVisible();
  await report.click();
  await expect(card.locator('.community-report-form')).toBeVisible();
  await card.locator('.community-report-form textarea').fill('テスト理由');
  await card.locator('.community-report-form .community-report-submit').click();
  await expect(card.locator('.community-report-form')).toBeHidden();
  await expect(card.locator('.community-report-status'))
    .toBeVisible();
  await expect(card.locator('.community-report-status'))
    .toHaveText('通報を受け付けました');
  await expect(report).toHaveText('通報済み');
  await expect(report).toBeDisabled();

  await page.locator('#communityRefresh').click();
  await expect(page.locator('.community-card')).toHaveCount(1);

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

// prettier-ignore
test('a shared older comment link opens a permitted single-comment preview', async ({ page }) => {
  await installIsolatedMock(page, true);
  const oldId = 'c0a00000-0000-4000-8000-000000000099';
  await page.goto('/community.html?comment=' + oldId + '#post-note%3A42', {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.locator('#community-comment-' + oldId)).toContainText(
    '過去のコメント本文'
  );
  // Browsers may reclaim initial fragment focus after async deep-link rendering.
  // Verify that the requested comment remains visible, highlighted, and focusable.
  await expect(page.locator('.community-comment-target')).toBeVisible();
  await expect(page.locator('.community-comment-target')).toHaveAttribute(
    'tabindex',
    '-1'
  );
  const calls = await page.evaluate(() => globalThis.__communityTestCalls);
  expect(calls).toContain('novelight_community_comment_detail');
});

// Layout regression: the shared badge must not inherit the truncation
// intended only for the work title, and Home links share one baseline.
// prettier-ignore
test('R15 badge remains fully visible and Home cover links align', async ({
  page
}) => {
  await installIsolatedMock(page, true);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityHomeFeed .community-card').first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const feed = globalThis.document.getElementById('communityHomeFeed');
    const novelLink = (title, rated) => {
      const a = globalThis.document.createElement('a');
      a.className = 'community-link';
      a.href = 'novel.html?id=not-a-number';
      if (rated) {
        const badge = globalThis.document.createElement('span');
        badge.className = 'nl-r15-badge';
        badge.textContent = 'R15';
        a.append(badge);
      }
      const cover = globalThis.document.createElement('img');
      cover.alt = '';
      cover.src =
        'data:image/svg+xml,' +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="48"/>');
      a.append(cover);
      const text = globalThis.document.createElement('span');
      text.textContent = title;
      a.append(text);
      return a;
    };
    feed.replaceChildren();
    for (const [index, title] of [
      '短い紹介文',
      '長い紹介文が折り返されるケースを確認します'.repeat(8),
      '普通の紹介文'.repeat(3)
    ].entries()) {
      const card = globalThis.document.createElement('article');
      card.className = 'community-card';
      const person = globalThis.document.createElement('div');
      person.className = 'community-person';
      person.textContent = 'テスト作者';
      const type = globalThis.document.createElement('span');
      type.className = 'community-type';
      type.textContent = '新作公開';
      const heading = globalThis.document.createElement('h3');
      heading.className = 'community-card-title';
      heading.textContent = title;
      card.append(
        person,
        type,
        heading,
        novelLink('とても長い作品タイトル'.repeat(6), index === 0)
      );
      feed.append(card);
    }
    const links = [...feed.querySelectorAll('.community-card > .community-link')];
    const badge = links[0].querySelector('.nl-r15-badge');
    const title = links[0].querySelector('span:not(.nl-r15-badge)');
    return {
      badgeText: badge.textContent,
      badgeWidth: badge.getBoundingClientRect().width,
      badgeScrollWidth: badge.scrollWidth,
      badgeRight: badge.getBoundingClientRect().right,
      titleLeft: title.getBoundingClientRect().left,
      linkBottoms: links.map((link) => link.getBoundingClientRect().bottom),
      isDesktop: globalThis.matchMedia('(min-width: 901px)').matches
    };
  });
  expect(layout.badgeText).toBe('R15');
  expect(layout.badgeWidth).toBeGreaterThanOrEqual(30);
  expect(layout.badgeWidth + 1).toBeGreaterThanOrEqual(layout.badgeScrollWidth);
  expect(layout.badgeRight).toBeLessThanOrEqual(layout.titleLeft + 1);
  if (layout.isDesktop) {
    const bottoms = layout.linkBottoms;
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(2);
  }
});
