import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('analytics.html', 'utf8');
const client = readFileSync('novelight-analytics.js', 'utf8');
const css = readFileSync('novelight-analytics.css', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260908172000_light_analytics_visual_trends.sql',
  'utf8'
);
const replay = readFileSync('scripts/run-migration-replay.sh', 'utf8');

test('LIGHT ANALYTICS keeps all five funnel metrics and period controls', () => {
  for (const label of [
    'インプレッション',
    '作品ページ到達',
    '第1話10秒閲覧',
    '第2話まで継続',
    '露出後お気に入り'
  ]) {
    assert.match(html, new RegExp(label));
  }

  for (const days of [7, 30, 90]) {
    assert.match(html, new RegExp(`data-days="${days}"`));
  }
});

test('summary cards have prior-period comparisons and mini trend charts', () => {
  for (const key of [
    'impressions',
    'detail_opens',
    'first_episode_reads_10s',
    'continued_to_episode_2',
    'favorites'
  ]) {
    assert.match(html, new RegExp(`id="change-${key}"`));
    assert.match(html, new RegExp(`id="spark-${key}"`));
    assert.match(client, new RegExp(`previous_${key}`));
  }

  assert.match(client, /データ蓄積中/u);
  assert.match(client, /直前\$\{days\}日比/u);
});

test('large trend chart supports all five funnel metrics without a chart dependency', () => {
  assert.match(html, /id="trendLine"/u);
  assert.match(html, /data-trend-metric="impressions"/u);
  assert.match(html, /data-trend-metric="detail_opens"/u);
  assert.match(html, /data-trend-metric="first_episode_reads_10s"/u);
  assert.match(html, /data-trend-metric="continued_to_episode_2"/u);
  assert.match(html, /data-trend-metric="favorites"/u);
  assert.match(client, /buildPath/u);
  assert.doesNotMatch(html, /chart\.js|recharts|highcharts/iu);
});

test('Free retains aggregate trends while per-work analytics stay Standard and Premium only', () => {
  assert.match(client, /if \(plan === 'free'\) renderFreeScope\(\)/u);
  assert.match(client, /作品ごとの分析はStandard以上/u);
  assert.match(client, /プランによる追加露出/u);
  assert.match(client, /Premium専用追加露出/u);
  assert.match(html, /id="workAnalyticsSection"/u);
});

test('visual trend RPC is aggregate-only, authenticated and bounded to 90 days', () => {
  assert.match(
    migration,
    /create function public\.novelight_author_analytics_timeseries/u
  );
  assert.match(migration, /author_id_snapshot = v_uid/u);
  assert.match(migration, /p_days \* 2/u);
  assert.match(migration, /p_days > 90/u);
  assert.match(migration, /previous_impressions bigint/u);
  assert.match(migration, /security definer/u);
  assert.match(migration, /set search_path = pg_catalog, public, auth/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_author_analytics_timeseries\(integer\)[\s\S]*to authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_author_analytics_timeseries\(integer\)[\s\S]*from public, anon/u
  );
});

test('migration replay exercises trend apply, behavior, rollback and reapply', () => {
  assert.match(replay, /20260908172000_light_analytics_visual_trends_postcheck\.sql/u);
  assert.match(replay, /tests\/rls\/light-analytics-visual-trends\.sql/u);
  assert.match(replay, /20260908172000_light_analytics_visual_trends_rollback\.sql/u);
  assert.match(replay, /20260908172000_light_analytics_visual_trends_precheck\.sql/u);
});

test('analytics styling is NOVELIGHT navy and gold and remains responsive', () => {
  assert.match(css, /--analytics-navy/u);
  assert.match(css, /--analytics-gold/u);
  assert.match(css, /\.funnel-visual/u);
  assert.match(css, /@media \(max-width: 520px\)/u);
});