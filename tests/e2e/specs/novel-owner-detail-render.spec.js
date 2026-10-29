import { expect, test } from '../fixtures/diagnostic-fixture.js';

const SAMPLE_SYNOPSIS =
  'かつて天才だった少年が新しい勝ち方を見つけていく。'.repeat(24);

test('novel owner sees title, synopsis, LIGHT SEED and received-seed panel', async ({
  page
}) => {
  await page.addInitScript((synopsis) => {
    globalThis.__NOVEL_DETAIL_TEST_SYNOPSIS__ = synopsis;
  }, SAMPLE_SYNOPSIS);
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
          const novel = {
            id: 354, user_id: 'test-author', status: 'published',
            title: '作品タイトルの表示確認', genre: '現代ファンタジー',
            description: window.__NOVEL_DETAIL_TEST_SYNOPSIS__,
            ai_usage: 'human', content_rating: 'general', content_warnings: [],
            created_at: '2026-09-28T00:00:00Z', show_episode_numbers: true,
            thumbnail_url: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22150%22%3E%3Crect%20width=%22100%22%20height=%22150%22%20fill=%22teal%22/%3E%3C/svg%3E'
          };
          function builder(table) {
            let selected = '';
            // Match actual Supabase behavior: unselected fields aren't returned.
            const projected = () => Object.fromEntries(
              selected.split(',').map((key) => key.trim())
                .filter((key) => Object.prototype.hasOwnProperty.call(novel, key))
                .map((key) => [key, novel[key]])
            );
            const api = {
              select(fields) { selected = fields; return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              range() { return api; },
              maybeSingle: async () => ({
                data: table === 'novels' ? projected() : null, error: null
              }),
              single: async () => ({
                data: table === 'novels' ? projected() : null,
                error: null
              }),
              then(resolve, reject) {
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
              }
            };
            return api;
          }
          const client = {
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'test-author' } } },
                error: null
              }),
              getUser: async () => ({
                data: { user: { id: 'test-author' } }, error: null
              }),
              onAuthStateChange: () => ({
                data: { subscription: { unsubscribe() {} } }
              })
            },
            rpc: async (name) => {
              // Delayed outline reproduces the real loading-placeholder race.
              if (name === 'novelight_novel_outline') {
                await new Promise((resolve) => setTimeout(resolve, 650));
              }
              return {
              data: name === 'novelight_novel_outline' ? [
                {
                  episode_id: 991, episode_number: 1,
                  episode_title: '公開中の第一話',
                  episode_status: 'published',
                  chapter_id: null, chapter_title: null
                },
                {
                  episode_id: 992, episode_number: 2,
                  episode_title: '下書きの第二話',
                  episode_status: 'draft',
                  chapter_id: null, chapter_title: null
                }
              ] : name === 'novelight_public_profile'
                ? [{ display_name: '作者の表示確認' }]
                : name === 'light_seed_status_auto_v1'
                  ? {
                    reason: 'own_novel',
                    monthly_limit: 11, remaining_this_month: 11,
                    total_seed_count: 2
                  }
                  : name === 'novelight_author_received_light_seed_summary'
                    ? {
                      total_seed_count: 2, gold_count: 1,
                      silver_count: 1, bronze_count: 0
                    }
                    : [],
              error: null
              };
            },
            from: (table) => builder(table)
          };
          window.supabase = { createClient: () => client };
        })();
      `
    });
  });

  await page.goto('/novel.html?id=354', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.nl-work-detail-grid')).toBeVisible();
  await expect(page.locator('.nl-work-detail-grid')).toHaveCount(1);

  // Desktop: the center card and table of contents extend to the left
  // column's bottom. The TOC must scroll inside its own card, never stick.
  if ((await page.evaluate(() => globalThis.innerWidth)) > 1050) {
    const aligned = await page.evaluate(() => {
      const bounds = (selector) =>
        globalThis.document.querySelector(selector).getBoundingClientRect();
      const left = bounds('.nl-work-detail-left');
      const main = bounds('.nl-work-detail-main');
      const toc = bounds('.nl-work-detail-toc');
      const grid = bounds('.nl-work-detail-grid');
      const seed = bounds('#lightSeedArea');
      const tocNode = globalThis.document.querySelector('.nl-work-detail-toc');
      return {
        leftToMain: Math.abs(left.bottom - main.bottom),
        leftToToc: Math.abs(left.bottom - toc.bottom),
        tocToGrid: Math.abs(toc.bottom - grid.bottom),
        tocToSeed: seed.top - toc.bottom,
        position: globalThis.getComputedStyle(tocNode).position
      };
    });
    expect(aligned.leftToMain).toBeLessThan(3);
    expect(aligned.leftToToc).toBeLessThan(3);
    expect(aligned.tocToGrid).toBeLessThan(3);
    expect(aligned.tocToSeed).toBeGreaterThanOrEqual(0);
    expect(aligned.position).toBe('static');

    // Even with many episodes, their overflow must not grow the outer grid.
    const scrolling = await page.evaluate(() => {
      const grid = globalThis.document.querySelector('.nl-work-detail-grid');
      const list = globalThis.document.querySelector('.nl-work-toc-list');
      const initialHeight = grid.getBoundingClientRect().height;
      const fragment = globalThis.document.createDocumentFragment();
      for (let i = 0; i < 100; i += 1) {
        const item = globalThis.document.createElement('a');
        item.className = 'nl-work-toc-link';
        item.href = '#test-chapter';
        item.textContent = `テスト用 第${i + 1}話`;
        fragment.appendChild(item);
      }
      list.appendChild(fragment);
      const canScroll = list.scrollHeight > list.clientHeight;
      list.scrollTop = list.scrollHeight;
      return {
        canScroll,
        scrolled: list.scrollTop > 0,
        gridGrowth: grid.getBoundingClientRect().height - initialHeight
      };
    });
    expect(scrolling.canScroll).toBe(true);
    expect(scrolling.scrolled).toBe(true);
    expect(Math.abs(scrolling.gridGrowth)).toBeLessThan(3);
  }
  await expect(page.locator('.nl-work-detail-cover img')).toBeVisible();
  await expect(page.locator('.nl-work-detail-cover img')).toHaveJSProperty(
    'naturalWidth',
    100
  );
  await expect(page.locator('.nl-work-detail-main > .title')).toBeVisible();
  await expect(page.locator('.nl-work-detail-main > .title')).toContainText(
    '作品タイトルの表示確認'
  );
  await expect(page.locator('.nl-work-detail-main > .author')).toBeVisible();
  await expect(page.locator('.nl-work-detail-left .tags')).toContainText(
    '現代ファンタジー'
  );
  const synopsis = page.locator(
    '.nl-work-detail-synopsis .novelight-native-synopsis'
  );
  await expect(synopsis).toBeVisible();
  await expect(synopsis.locator('summary')).toBeVisible();
  await expect(synopsis.locator('summary')).toContainText(
    'かつて天才だった少年'
  );
  await synopsis.locator('summary').click();
  await expect(synopsis).toHaveAttribute('open');
  await expect(synopsis.locator('.description')).toHaveText(SAMPLE_SYNOPSIS);

  await expect(page.locator('#lightSeedArea')).toBeVisible();
  await expect(page.locator('#lightSeedArea')).toContainText('LIGHT SEED');
  await expect(page.locator('#publicLightSeedCount')).toHaveText('2 個');
  await expect(page.locator('.light-seed-public-summary img')).toBeVisible();
  await expect(page.locator('.light-seed-public-summary img')).toHaveJSProperty(
    'complete',
    true
  );
  await expect(page.locator('#receivedSeedArea')).toBeVisible();
  await expect(page.locator('#receivedSeedGold')).toHaveText('1');
  await expect(page.locator('#receivedSeedSilver')).toHaveText('1');
  await expect(page.locator('#receivedSeedBronze')).toHaveText('0');
  await expect(page.locator('.nl-work-detail-bookmeta')).toBeVisible();
  await expect(page.locator('.nl-work-detail-toc')).toContainText('下書き');
  await expect(page.locator('.nl-work-author-episodes')).toHaveText(
    '公開1話・下書き1話'
  );
  // Updating identical textContent was recreating a text node on every
  // animation frame, waking the page-wide MutationObserver indefinitely.
  const redundantMutations = await page.evaluate(async () => {
    const target = globalThis.document.querySelector(
      '.nl-work-author-episodes'
    );
    let mutations = 0;
    const observer = new globalThis.MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(target, { childList: true, subtree: true });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    observer.disconnect();
    return mutations;
  });
  expect(redundantMutations).toBe(0);

  // Regression: asynchronously added character cards must NOT stretch the
  // left sidebar to the combined height of the synopsis and characters.
  const characterLayout = await page.evaluate(() => {
    const dom = globalThis.document;
    const center = dom.querySelector('.nl-work-detail-center');
    const section = dom.createElement('section');
    section.className = 'nl-work-character-section';
    const heading = dom.createElement('h2');
    heading.textContent = '登場人物';
    const cards = dom.createElement('div');
    cards.className = 'nl-work-character-grid';
    for (let index = 0; index < 6; index += 1) {
      const card = dom.createElement('article');
      card.className = 'nl-work-character-card';
      card.textContent = `キャラクター${index + 1}の紹介`;
      cards.appendChild(card);
    }
    section.append(heading, cards);
    center.appendChild(section);
    const rect = (selector) =>
      dom.querySelector(selector).getBoundingClientRect();
    const left = rect('.nl-work-detail-left');
    const main = rect('.nl-work-detail-main');
    const characters = rect('.nl-work-character-section');
    const toc = rect('.nl-work-detail-toc');
    const grid = rect('.nl-work-detail-grid');
    const seed = rect('#lightSeedArea');
    const desktop = globalThis.innerWidth > 1050;
    return {
      desktop,
      leftToMain: Math.abs(left.bottom - main.bottom),
      charactersBelowMain: characters.top - main.bottom,
      tocToGrid: Math.abs(toc.bottom - grid.bottom),
      tocCoversCharacters: toc.bottom >= characters.bottom - 3,
      seedBelowToc: seed.top >= toc.bottom,
      centerDisplay: globalThis.getComputedStyle(center).display,
      leftDisplay: globalThis.getComputedStyle(
        dom.querySelector('.nl-work-detail-left')
      ).display
    };
  });
  if (characterLayout.desktop) {
    expect(characterLayout.leftToMain).toBeLessThan(3);
    expect(characterLayout.charactersBelowMain).toBeGreaterThanOrEqual(0);
    expect(characterLayout.seedBelowToc).toBe(true);
    expect(characterLayout.centerDisplay).toBe('contents');
    expect(characterLayout.leftDisplay).toBe('flex');
  } else {
    expect(characterLayout.centerDisplay).not.toBe('contents');
  }
});
