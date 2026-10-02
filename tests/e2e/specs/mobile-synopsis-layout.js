import { expect, test } from '../fixtures/diagnostic-fixture.js';

const LONG_SYNOPSIS =
  'ローマでの商談を終え帰国を控えていた実業家アーサー。スペイン階段のふもとで彼が見つけたのは、スマートフォンと小さな財布だけを持った一人の日本人女性だった。'.repeat(
    8
  );

async function installSupabaseStub(page, rpcData) {
  await page.addInitScript((data) => {
    globalThis.__NOVELIGHT_MOBILE_SYNOPSIS_RPC_DATA__ = data;
  }, rpcData);

  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
          const data = window.__NOVELIGHT_MOBILE_SYNOPSIS_RPC_DATA__ || {};
          function builder() {
            const api = {
              select() { return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              range() { return api; },
              maybeSingle: async () => ({ data: null, error: null }),
              single: async () => ({ data: null, error: null }),
              then(resolve, reject) {
                return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
              }
            };
            return api;
          }
          const client = {
            auth: {
              getSession: async () => ({ data: { session: null }, error: null }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
            },
            rpc: async (name) => ({
              data: Object.prototype.hasOwnProperty.call(data, name) ? data[name] : [],
              error: null
            }),
            from: () => builder()
          };
          window.supabase = { createClient: () => client };
        })();
      `
    });
  });
}

async function captureLayout(page, selectors) {
  return page.evaluate((names) => {
    const box = (selector) => {
      const element = globalThis.document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        fontSize: style.fontSize
      };
    };
    return Object.fromEntries(
      Object.entries(names).map(([name, selector]) => [name, box(selector)])
    );
  }, selectors);
}

function expectFullWidthSynopsis(layout) {
  expect(layout.card).not.toBeNull();
  expect(layout.synopsis).not.toBeNull();
  expect(layout.cover).not.toBeNull();
  expect(layout.synopsis.fontSize).toBe('17px');
  expect(layout.synopsis.x - layout.card.x).toBeLessThan(32);
  expect(layout.card.right - layout.synopsis.right).toBeLessThan(26);
  expect(layout.synopsis.y).toBeGreaterThanOrEqual(layout.cover.bottom - 1);
}

test('ranking synopsis uses the full mobile card width and keeps desktop intact', async ({
  page
}, testInfo) => {
  await installSupabaseStub(page, {
    novelight_ranking_feed_v2: [
      {
        novel_id: 'rank-mobile-1',
        title: 'ローマで拾った君の名前を、僕はまだ知らない',
        genre: '現代ドラマ',
        description: LONG_SYNOPSIS,
        author_name: 'E2E Author',
        valid_read_count: 12,
        favorite_count: 3
      }
    ],
    novelight_public_thumbnail_urls: [
      { novel_id: 'rank-mobile-1', thumbnail_url: null }
    ]
  });

  await page.goto('/ranking.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.nl-synopsis-toggle')).toBeVisible();

  const layout = await captureLayout(page, {
    card: '.card',
    cover: '.card > .novel-cover-placeholder',
    title: '.ranking-card-copy > .title',
    synopsis: '.ranking-card-copy > .desc'
  });

  if (testInfo.project.name === 'mobile-chromium') {
    expectFullWidthSynopsis(layout);
    const overflow = await page.locator('html').evaluate((html) => ({
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  } else {
    expect(layout.synopsis.fontSize).toBe('18px');
    expect(layout.synopsis.x).toBeGreaterThan(layout.cover.right);
  }

  await page.locator('.nl-synopsis-toggle').click();
  await expect(page.locator('.desc')).toHaveClass(/is-expanded/);
});

test('search synopsis and metadata use the full mobile card width and keep desktop intact', async ({
  page
}, testInfo) => {
  await installSupabaseStub(page, {
    novelight_trusted_discovery_feed: [
      {
        novel_id: 'search-mobile-1',
        id: 'search-mobile-1',
        title: 'ローマで拾った君の名前を、僕はまだ知らない',
        genre: '現代ドラマ',
        description: LONG_SYNOPSIS,
        author_name: 'E2E Author',
        created_at: '2026-09-30T00:00:00Z',
        ai_usage: 'human',
        content_rating: 'general',
        is_premium_slot: false,
        favorite_count: 3,
        pv: 20
      }
    ],
    novelight_search_card_metadata: [
      {
        novel_id: 'search-mobile-1',
        author_name: 'E2E Author',
        published_episode_count: 12,
        published_character_count: 54000,
        official_tag_names: ['現代', '恋愛'],
        custom_tag_names: [],
        favorite_count: 3,
        pv: 20,
        is_completed: false,
        ai_usage: 'human',
        content_rating: 'general'
      }
    ],
    novelight_public_thumbnail_urls: [
      { novel_id: 'search-mobile-1', thumbnail_url: null }
    ]
  });

  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.novel-card')).toHaveCount(1);
  await expect(page.locator('.nl-synopsis-toggle')).toBeVisible();

  const layout = await captureLayout(page, {
    card: '.novel-card',
    cover: '.novel-card > .novel-cover-placeholder',
    title: '.search-card-copy > .title',
    synopsis: '.search-card-copy > .description',
    meta: '.search-card-copy > .meta'
  });

  if (testInfo.project.name === 'mobile-chromium') {
    expectFullWidthSynopsis(layout);
    expect(layout.meta.x - layout.card.x).toBeLessThan(32);
    expect(layout.card.right - layout.meta.right).toBeLessThan(26);
    const overflow = await page.locator('html').evaluate((html) => ({
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  } else {
    expect(layout.synopsis.fontSize).toBe('18px');
    expect(layout.synopsis.x).toBeGreaterThan(layout.cover.right);
  }

  await page.locator('.nl-synopsis-toggle').click();
  await expect(page.locator('.description')).toHaveClass(/is-expanded/);
});
