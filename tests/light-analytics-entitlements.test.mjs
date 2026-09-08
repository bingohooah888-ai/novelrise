import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [analytics, pricing, author, migration] = await Promise.all([
  readFile('novelight-analytics.js', 'utf8'),
  readFile('pricing.html', 'utf8'),
  readFile('author.html', 'utf8'),
  readFile(
    'supabase/migrations/20260906204500_light_analytics_plan_entitlements.sql',
    'utf8'
  )
]);

test('Free analytics is aggregate-only and fails closed', () => {
  assert.match(analytics, /let plan = 'free';/u);
  assert.match(analytics, /function normalizePlan\(value\)/u);
  assert.match(analytics, /if \(profile\.error\)[\s\S]*plan = 'free';/u);
  assert.match(
    analytics,
    /if \(plan === 'free'\) renderFreeScope\(\);[\s\S]*else renderWorks\(rows\);/u
  );
  assert.match(analytics, /Freeでは全作品合計の基本LIGHT ANALYTICS/u);
  assert.match(analytics, /作品ごとのファネルと追加露出の効果はStandard以上/u);
});

test('server analytics enforces plan detail boundaries', () => {
  assert.match(migration, /v_plan text := 'free'/u);
  assert.match(migration, /from public\.profiles p/u);
  assert.match(migration, /where p\.id = v_uid/u);
  assert.match(migration, /v_plan := coalesce\(v_plan, 'free'\)/u);
  assert.match(migration, /where v_plan in \('standard', 'premium'\)/u);
  assert.match(migration, /null::text,[\s\S]*null::text/u);
  assert.match(migration, /coalesce\(sum\(a\.impressions\), 0\)::bigint/u);
  assert.match(migration, /having v_plan = 'free'/u);
  assert.match(migration, /v_plan = 'premium'/u);
  assert.match(migration, /a\.premium_impressions else 0::bigint/u);
  assert.match(migration, /novelight_author_exposure_funnel_v2\(p_days\)/u);
});

test('paid analytics keeps exposure effects separated', () => {
  assert.match(analytics, /プランによる追加露出：表示/u);
  assert.match(analytics, /plan_extra_detail_opens/u);
  assert.match(analytics, /plan_extra_body_reads_10s/u);
  assert.match(analytics, /Premium専用追加露出：表示/u);
  assert.match(analytics, /premium_slot_detail_opens/u);
  assert.match(analytics, /premium_slot_body_reads_10s/u);
  assert.match(analytics, /plan === 'premium'/u);
});

test('pricing terminology stays aligned', () => {
  assert.match(pricing, /基本LIGHT ANALYTICS/u);
  assert.match(pricing, /作品別LIGHT ANALYTICS/u);
  assert.match(pricing, /Premium専用枠の効果を可視化/u);
  assert.match(pricing, /新作48時間ブースト/u);
});

test('public author profile does not expose subscription plan', () => {
  assert.doesNotMatch(author, /現在プラン/u);
  assert.doesNotMatch(author, /契約プラン/u);
  assert.doesNotMatch(author, /STANDARD（β無料）/u);
});
