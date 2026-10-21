import { expect, test } from '@playwright/test';

// Inquiry #71 regression: exercise the real author.html + official thumbnail runtime
// against deterministic in-browser publication data. No staging or production writes.
const longSynopsis = [
  '一段落目です。物語の始まりを紹介します。',
  '',
  '二段落目です。途中の空行も、作者が入力したまま保持します。',
  '三段落目です。友人たちとの出会いが描かれます。',
  '四段落目です。過去の謎が浮かび上がります。',
  '五段落目です。思わぬ事件が起こります。',
  '六段落目です。さらに長い説明を続けます。',
  '七段落目です。物語の結末に向けた予感があります。'
].join('\n');

const mockVendor = `
  (() => {
    const novels = [
      { id: 801, title: 'とても長い題名を持つ物語'.repeat(6), genre: 'ファンタジー',
        description: ${JSON.stringify(longSynopsis)}, ai_usage: 'human',
        content_rating: 'general', status: 'published',
        thumbnail_url: '/assets/novelight-header-logo.webp' },
      { id: 802, title: '表紙がまだない作品', genre: '現代ドラマ',
        description: '短いあらすじです。\\n次の一文です。', ai_usage: 'ai_assisted',
        content_rating: 'general', status: 'published', thumbnail_url: null }
    ];
    const client = {
      rpc: async (name) => {
        if (name === 'novelight_public_profile')
          return {data: {display_name: '確認用の作者', bio: '紹介文'}, error:null};
        if (name === 'novelight_thumbnail_compositions_v3')
          return {data: [], error:null};
        return {data: [], error:null};
      },
      from(table) {
        return {
          select(fields) {
            const query = {
              eq() { return query; },
              order() { return Promise.resolve({data: novels, error:null}); },
              in(key, ids) { return Promise.resolve({
                data: novels.filter(n => ids.map(String).includes(String(n.id)))
                  .map(n => ({id:n.id,thumbnail_url:n.thumbnail_url})),
                error:null
              }); }
            };
            return query;
          }
        };
      }
    };
    window.supabase = { createClient: () => client };
  })();
`;

const noOpDependencies = {
  'novelight-client.js': `
    window.NovelightClient = {
      captureAcquisition:async()=>{},recordVisit:async()=>{},
      claimAcquisition:async()=>{},getVisitorToken:()=> 'fixture'
    };`,
  'novelight-profile-favorite-genres.js':
    'window.NovelightProfileFavoriteGenres={mountPublic:()=>{}};',
  'novelight-author-follow.js':
    'window.NovelightAuthorFollow={mountAuthorFollowControls:()=>{}};',
  'novelight-user-safety.js':
    'window.NovelightUserSafety={mountAuthorControls:()=>{}};',
  'novelight-author-notes-public.js': '',
  'novelight-public-scout.js': ''
};

test('author cards preserve paragraphs, covers and links', async ({ page }) => {
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: mockVendor
    })
  );
  for (const [script, body] of Object.entries(noOpDependencies)) {
    await page.route(`**/${script}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body
      })
    );
  }

  await page.goto('/author.html?id=fixture-author', {
    waitUntil: 'domcontentloaded'
  });
  const cards = page.locator('#list .novel-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('.title')).toContainText('とても長い題名');
  const cover = cards.first().locator('.card-media img');
  const fallback = cards.nth(1).locator('.card-media .novel-cover-placeholder');
  await expect(cover).toHaveCount(1);
  await expect(fallback).toHaveCount(1);
  await expect(cards.first().locator('.card-detail-link')).toHaveText(
    '作品詳細を見る →'
  );
  await expect(page.locator('#list .nl-synopsis-toggle')).toHaveCount(0);

  const content = await cards.first().locator('.desc').evaluate((node) => {
    const style = getComputedStyle(node);
    const parent = node.closest('.novel-card');
    return {
      text: node.textContent,
      whiteSpace: style.whiteSpace,
      clamp: style.getPropertyValue('-webkit-line-clamp'),
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      cardRight: parent.getBoundingClientRect().right,
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(content.text).toBe(longSynopsis);
  expect(content.whiteSpace).toBe('pre-wrap');
  const expectedClamp = await page.evaluate(() =>
    window.matchMedia('(max-width:640px)').matches ? 4 : 5
  );
  expect(content.clamp).toBe(String(expectedClamp));
  expect(content.height).toBeLessThanOrEqual(
    content.lineHeight * expectedClamp + 3
  );
  expect(content.cardRight).toBeLessThanOrEqual(content.viewport + 1);
  expect(content.scrollWidth).toBeLessThanOrEqual(content.viewport + 1);

  await expect(cards.first()).toHaveAttribute('href', 'novel.html?id=801');
  await expect(cards.nth(1)).toHaveAttribute('href', 'novel.html?id=802');
});
