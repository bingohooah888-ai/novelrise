import { expect, test } from '../fixtures/diagnostic-fixture.js';

// Runs locally with in-browser mocks; never accesses Staging or Production.
const authorId = '00000000-0000-4000-8000-000000000001';
const followerId = '00000000-0000-4000-8000-000000000002';

async function mountMock(page, authenticated = true) {
  const script = [
    'window.__followMock = {',
    '  calls: [],',
    '  following: [{',
    "    author_user_id: '__AUTHOR_ID__',",
    "    display_name: '小説作者',",
    '    avatar_path: null, notify_new_works: true, notify_updates: false',
    '  }],',
    '  followers: [{',
    "    user_id: '__FOLLOWER_ID__', display_name: '愛読者', avatar_path: null",
    '  }]',
    '};',
    'window.supabase = { createClient: () => ({',
    '  auth: { getSession: async () => ({',
    '    error: null,',
    '    data: { session: ' +
      (authenticated ? "{ user: { id: '__FOLLOWER_ID__' } }" : 'null') +
      ' }',
    '  }) },',
    '  rpc: async (name, args = {}) => {',
    '    const s = window.__followMock;',
    '    s.calls.push({ name, args });',
    "    if (name === 'novelight_follow_counts') return {",
    '      data: { followers: s.followers.length,',
    '        following: s.following.length }, error: null',
    '    };',
    "    if (name === 'novelight_followed_authors') return {",
    '      data: s.following.slice(args.p_offset,',
    '        args.p_offset + args.p_limit), error: null',
    '    };',
    "    if (name === 'novelight_followers') return {",
    '      data: s.followers.slice(args.p_offset,',
    '        args.p_offset + args.p_limit), error: null',
    '    };',
    "    if (name === 'novelight_set_author_follow_notifications') {",
    '      s.following[0].notify_new_works = args.p_notify_new_works;',
    '      s.following[0].notify_updates = args.p_notify_updates;',
    '      return { data: { following: true,',
    '        notify_new_works: args.p_notify_new_works,',
    '        notify_updates: args.p_notify_updates }, error: null };',
    '    }',
    "    if (name === 'novelight_set_author_follow') {",
    '      s.following = [];',
    '      return { data: { following: false }, error: null };',
    '    }',
    "    throw Error('Unexpected RPC: ' + name);",
    '  }',
    '}) };'
  ].join('\n')
    .replaceAll('__AUTHOR_ID__', authorId)
    .replaceAll('__FOLLOWER_ID__', followerId);

  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: script })
  );
  await page.route('**/novelight-client.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.NovelightClient = { syncAuthHeader: async () => {} };'
    })
  );
  await page.route('**/novelight-public-avatar.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.NovelightPublicAvatar = { paint: () => {} };'
    })
  );
  await page.route('https://**.supabase.co/**', (route) => route.abort());
}

test('following list supports tab switching, notices and unfollow', async ({
  page
}) => {
  await mountMock(page);
  await page.goto('/following.html?tab=following');
  const following = page.getByRole('tab', { name: /フォロー中/ });
  const followers = page.getByRole('tab', { name: /フォロワー/ });
  await expect(following).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: '小説作者' })).toBeVisible();
  await expect(following).toContainText('1');

  const notices = page.locator('.follow-option input');
  await expect(notices.nth(0)).toBeChecked();
  await notices.nth(1).check();
  await expect(page.getByText('通知設定を保存しました。')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'フォロー解除' }).click();
  await expect(page.getByText('フォロー中の作者はいません')).toBeVisible();
  await expect(following).toContainText('0');

  await followers.click();
  await expect(followers).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: '愛読者' })).toHaveAttribute(
    'href',
    'author.html?id=' + followerId
  );
  await expect(followers).toContainText('1');
  const calls = await page.evaluate(() => window.__followMock.calls);
  expect(calls.some((entry) =>
    entry.name === 'novelight_set_author_follow_notifications'
  )).toBeTruthy();
  expect(calls.some((entry) =>
    entry.name === 'novelight_set_author_follow'
  )).toBeTruthy();
});

test('anonymous visitors never call private follow list RPCs', async ({
  page
}) => {
  await mountMock(page, false);
  await page.goto('/following.html?tab=followers');
  await expect(page.getByText('一覧を見るにはログインが必要です。'))
    .toBeVisible();
  await expect(page.getByRole('link', { name: 'ログインする' }))
    .toHaveAttribute('href', /login.html/);
  const calls = await page.evaluate(() => window.__followMock.calls);
  expect(calls).toEqual([]);
});
