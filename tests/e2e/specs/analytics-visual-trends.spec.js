import { expect, test } from '../fixtures/diagnostic-fixture.js';

function trendRows(count = 30) {
  return Array.from({ length: count }, (_, index) => {
    const active = index >= count - 4;
    return {
      bucket_date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      impressions: active ? index + 3 : 0,
      detail_opens: active ? index + 1 : 0,
      first_episode_reads_10s: active ? Math.max(1, index - 2) : 0,
      continued_to_episode_2: active ? Math.max(1, index - 4) : 0,
      favorites: active ? Math.max(1, index - 8) : 0,
      current_impressions: 120,
      current_detail_opens: 60,
      current_first_episode_reads_10s: 42,
      current_continued_to_episode_2: 28,
      current_favorites: 14,
      previous_impressions: 100,
      previous_detail_opens: 50,
      previous_first_episode_reads_10s: 35,
      previous_continued_to_episode_2: 25,
      previous_favorites: 10
    };
  });
}

function funnelRows() {
  return [
    {
      novel_id: '8101',
      title: '星灯りの物語',
      impressions: 120,
      detail_opens: 60,
      body_reads_10s: 42,
      detail_rate_pct: 50,
      body_read_rate_pct: 35,
      first_episode_reads_10s: 42,
      continued_to_episode_2: 28,
      episode1_to_episode2_rate_pct: 66.67,
      favorites: 14,
      favorite_rate_pct: 11.67,
      initial_exposure_impressions: 6,
      plan_extra_impressions: 24,
      plan_extra_detail_opens: 12,
      plan_extra_body_reads_10s: 9,
      plan_extra_body_read_rate_pct: 37.5,
      premium_slot_impressions: 0,
      premium_slot_detail_opens: 0,
      premium_slot_body_reads_10s: 0,
      premium_slot_body_read_rate_pct: null
    }
  ];
}

async function installAnalyticsStub(page, authorPlan = 'standard') {
  await page.addInitScript(
    ({ plan, trends, funnel }) => {
      globalThis.__NOVELIGHT_ANALYTICS_E2E__ = {
        plan,
        trends,
        funnel,
        calls: []
      };
    },
    { plan: authorPlan, trends: trendRows(), funnel: funnelRows() }
  );

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          (() => {
            const state = window.__NOVELIGHT_ANALYTICS_E2E__;
            function profileBuilder() {
              const api = {
                select() { return api; },
                eq() { return api; },
                single: async () => ({ data: { plan: state.plan }, error: null })
              };
              return api;
            }
            const client = {
              auth: {
                getSession: async () => ({
                  data: { session: { user: { id: 'analytics-e2e-author' } } },
                  error: null
                }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
              },
              rpc: async (name, args) => {
                state.calls.push({ name, args });
                if (name === 'novelight_author_exposure_funnel_v2') {
                  return { data: state.plan === 'free' ? [{
                    ...state.funnel[0], novel_id: null, title: null,
                    plan_extra_impressions: 0, plan_extra_detail_opens: 0,
                    plan_extra_body_reads_10s: 0, premium_slot_impressions: 0,
                    premium_slot_detail_opens: 0, premium_slot_body_reads_10s: 0
                  }] : state.funnel, error: null };
                }
                if (name === 'novelight_author_analytics_timeseries') {
                  return { data: state.trends, error: null };
                }
                if (name === 'novelight_author_basic_metrics') {
                  return { data: [{ novel_count: 3, total_pv: 480, total_favorites: 36 }], error: null };
                }
                return { data: true, error: null };
              },
              from: () => profileBuilder()
            };
            window.supabase = { createClient: () => client };
          })();
        `
      });
    }
  );
}

test('Standard LIGHT ANALYTICS renders comparisons, sparklines, trend selector and work funnel', async ({
  page
}) => {
  await installAnalyticsStub(page, 'standard');
  await page.goto('/analytics.html');

  await expect(page.locator('#summary .metric')).toHaveCount(5);
  await expect(page.locator('#impressions')).toHaveText('120');
  await expect(page.locator('#change-impressions')).toContainText('↑ 20.0%');
  await expect(page.locator('#spark-impressions')).not.toHaveAttribute('d', '');
  await expect(page.locator('#trendLine')).not.toHaveAttribute('d', '');
  await expect(page.locator('#trendTitle')).toContainText('インプレッション・30日間の推移');
  await expect(page.locator('#workAnalyticsHeading')).toBeVisible();
  await expect(page.locator('.funnel-node')).toHaveCount(5);
  await expect(page.locator('.paid').first()).toContainText('プランによる追加露出');
  await expect(page.locator('#novelCount')).toHaveText('3');

  await page.getByRole('button', { name: '作品ページ' }).click();
  await expect(page.locator('#trendTitle')).toContainText('作品ページ到達・30日間の推移');
});

test('period switch reloads both aggregate funnel and trend RPC for the selected window', async ({
  page
}) => {
  await installAnalyticsStub(page, 'standard');
  await page.goto('/analytics.html');
  await page.locator('#period button[data-days="7"]').click();

  await expect(page.locator('#trendTitle')).toContainText('7日間の推移');
  await expect(page.locator('#change-impressions')).toContainText('直前7日比');

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_ANALYTICS_E2E__.calls);
  expect(
    calls.some(
      (call) =>
        call.name === 'novelight_author_exposure_funnel_v2' && call.args?.p_days === 7
    )
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.name === 'novelight_author_analytics_timeseries' && call.args?.p_days === 7
    )
  ).toBe(true);
});

test('Free keeps aggregate visual trends but does not expose per-work analytics', async ({
  page
}) => {
  await installAnalyticsStub(page, 'free');
  await page.goto('/analytics.html');

  await expect(page.locator('#impressions')).toHaveText('120');
  await expect(page.locator('#trendLine')).not.toHaveAttribute('d', '');
  await expect(page.locator('#workAnalyticsHeading')).toBeHidden();
  await expect(page.locator('#works')).toContainText('Freeでは全作品合計');
  await expect(page.locator('#planNotice')).toContainText('期間推移と前期間比較は利用できます');
  await expect(page.locator('#works')).not.toContainText('星灯りの物語');
});

test('visual analytics stays within the mobile viewport', async ({ page }) => {
  await installAnalyticsStub(page, 'standard');
  await page.goto('/analytics.html');

  const overflow = await page.evaluate(
    () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#summary .metric').first()).toBeVisible();
  await expect(page.locator('.trend-panel')).toBeVisible();
});