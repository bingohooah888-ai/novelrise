import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function installDiscoveryStub(page, rpcData = {}) {
  await page.addInitScript((data) => {
    globalThis.__NOVELIGHT_E2E_RPC_DATA__ = data;
    globalThis.__NOVELIGHT_E2E_CALLS__ = [];
  }, rpcData);

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const data = window.__NOVELIGHT_E2E_RPC_DATA__ || {};
          const calls = window.__NOVELIGHT_E2E_CALLS__ || [];
          function builder(table) {
            const api = {
              select() { return api; },
              eq() { return api; },
              in() { return api; },
              order() { return api; },
              limit() { return api; },
              maybeSingle: async () => ({ data: null, error: null }),
              then(resolve, reject) {
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
              }
            };
            return api;
          }
          const client = {
            auth: {
              getSession: async () => ({ data: { session: null }, error: null }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
            },
            rpc: async (name, args) => {
              calls.push({ type: 'rpc', name, args });
              return {
                data: Object.prototype.hasOwnProperty.call(data, name) ? data[name] : true,
                error: null
              };
            },
            from: (table) => builder(table)
          };
          window.supabase = { createClient: () => client };
        })();
      `
      });
    }
  );
}

function seededRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    novel_id: String(7000 + index),
    title: `Seeded Work ${index + 1}`,
    genre: 'ファンタジー',
    description: 'LIGHT SEED feed E2E',
    created_at: new Date(Date.UTC(2026, 7, 31 - index)).toISOString(),
    pv: index,
    author_id: 'author-e2e',
    author_name: 'Seed Author',
    thumbnail_url: `https://example.invalid/seed-${index + 1}.webp`,
    status: 'published',
    favorite_count: index,
    light_seed_count: index + 1
  }));
}

test('Home renders the formal LIGHT SEED feed once and respects the viewport limit', async ({
  page
}) => {
  await installDiscoveryStub(page, {
    novelight_trusted_discovery_feed: [],
    novelight_trusted_plan_extra_feed: [],
    novelight_neutral_search: [],
    novelight_light_seed_feed: seededRows(7)
  });

  await page.goto('/index.html');

  const expected = await page.evaluate(() =>
    globalThis.matchMedia('(max-width:860px)').matches ? 4 : 6
  );
  await expect(page.locator('#seedShelfSection')).toBeVisible();
  await expect(page.locator('#seedGrid .seed-card')).toHaveCount(expected);
  await expect(page.locator('#seedGrid .seed-card').first()).toHaveAttribute(
    'href',
    'novel.html?id=7000'
  );
  await expect(page.locator('#seedGrid .seed-count').first()).toContainText(
    '1'
  );

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_E2E_CALLS__);
  const seedCalls = calls.filter(
    (call) => call.name === 'novelight_light_seed_feed'
  );
  const statusCalls = calls.filter((call) => call.name === 'light_seed_status');
  expect(seedCalls).toHaveLength(1);
  expect(statusCalls).toHaveLength(0);
  expect(seedCalls[0].args.p_limit).toBe(expected);
  expect(seedCalls[0].args.p_offset).toBe(0);
});

test('Home hides the LIGHT SEED shelf only when the formal feed is empty', async ({
  page
}) => {
  await installDiscoveryStub(page, {
    novelight_trusted_discovery_feed: [],
    novelight_trusted_plan_extra_feed: [],
    novelight_neutral_search: [],
    novelight_light_seed_feed: []
  });

  await page.goto('/index.html');
  await expect(page.locator('#seedShelfSection')).toBeHidden();
});

test('Home discovery shelves read as one compact discovery zone', async ({
  page
}) => {
  await installDiscoveryStub(page, {
    novelight_trusted_discovery_feed: [],
    novelight_trusted_plan_extra_feed: [],
    novelight_neutral_search: [],
    novelight_light_seed_feed: seededRows(2)
  });

  await page.goto('/index.html');
  const gaps = await page.evaluate(() => {
    const gap = (fromId, toId) => {
      const fromGrid = globalThis.document.querySelector(
        `#${fromId} .shelf-grid`
      );
      const toHead = globalThis.document.querySelector(`#${toId} .shelf-head`);
      const from = fromGrid.getBoundingClientRect();
      const to = toHead.getBoundingClientRect();
      return Math.round(to.top - from.bottom);
    };
    return {
      recommendedToNew: gap('discover', 'new-arrivals'),
      newToSeed: gap('new-arrivals', 'seedShelfSection'),
      mobile: globalThis.matchMedia('(max-width:700px)').matches
    };
  });

  const expectedGap = gaps.mobile ? 18 : 24;
  expect(Math.abs(gaps.recommendedToNew - expectedGap)).toBeLessThanOrEqual(2);
  expect(Math.abs(gaps.newToSeed - expectedGap)).toBeLessThanOrEqual(2);
});

test('dedicated LIGHT SEED page uses one paged feed without per-work status RPCs', async ({
  page
}) => {
  await installDiscoveryStub(page, {
    novelight_light_seed_feed: seededRows(25),
    record_neutral_search_impressions: true
  });

  await page.goto('/light-seed.html');
  await expect(page.locator('#discoveryList .seed-card')).toHaveCount(24);
  await expect(page.locator('#discoveryMoreWrap')).toBeVisible();

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_E2E_CALLS__);
  const seedCalls = calls.filter(
    (call) => call.name === 'novelight_light_seed_feed'
  );
  const statusCalls = calls.filter((call) => call.name === 'light_seed_status');
  expect(seedCalls).toHaveLength(1);
  expect(statusCalls).toHaveLength(0);
});

test('all five exploration pages use the compact shared outer spacing', async ({
  page
}) => {
  await installDiscoveryStub(page, {
    novelight_trusted_discovery_feed: [],
    novelight_neutral_search: [],
    novelight_light_seed_feed: [],
    novelight_ranking_feed: [],
    record_neutral_search_impressions: true
  });

  const routes = [
    ['recommended.html', 'list'],
    ['new-arrivals.html', 'list'],
    ['light-seed.html', 'list'],
    ['ranking.html', 'margin'],
    ['search.html', 'margin']
  ];

  for (const [route, kind] of routes) {
    await page.goto(`/${route}`);
    const spacing = await page.evaluate((layoutKind) => {
      const main = globalThis.document.querySelector('main');
      const style = globalThis.getComputedStyle(main);
      const mobile = globalThis.matchMedia('(max-width:700px)').matches;
      const topValue =
        layoutKind === 'list' ? style.paddingTop : style.marginTop;
      const bottomValue =
        layoutKind === 'list' ? style.paddingBottom : style.marginBottom;
      return {
        top: parseFloat(topValue),
        bottom: parseFloat(bottomValue),
        mobile,
        mainBottom: main.getBoundingClientRect().bottom,
        footerTop: globalThis.document
          .querySelector('footer')
          .getBoundingClientRect().top
      };
    }, kind);

    expect(spacing.top).toBe(spacing.mobile ? 20 : 34);
    expect(spacing.bottom).toBe(spacing.mobile ? 34 : 46);
    expect(spacing.footerTop).toBeGreaterThanOrEqual(spacing.mainBottom - 1);
  }
});
