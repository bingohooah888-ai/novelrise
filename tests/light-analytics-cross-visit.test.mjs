import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20261110172000_author_reader_retention_cross_visit.sql');
const html = read('analytics.html');
const runtime = read('novelight-analytics.js');
const replay = read('scripts/run-migration-replay.sh');
const fixture = read('tests/rls/light-analytics-cross-visit.sql');

test('reader continuation uses author/work/viewer cohort, not a single impression ID', () => {
  assert.equal((migration.match(/reader_cohorts as materialized/gu) || []).length, 2);
  assert.match(migration, /group by c\.novel_id_snapshot, c\.viewer_key_snapshot/u);
  assert.match(migration, /min\(c\.converted_at\) filter/u);
  assert.match(migration, /max\(c\.converted_at\) filter/u);
  assert.match(migration, /rc\.last_second_at > rc\.first_at/u);
  assert.match(migration, /reader_retention as \(/u);
  assert.match(migration, /reader_daily as materialized/u);
  assert.match(migration, /c\.author_id_snapshot = v_uid/u);
  assert.match(migration, /p_days > 90/u);
});

test('per-work analysis remains plan-gated, trend aggregates remain author-only', () => {
  assert.match(migration, /where v_plan in \('standard', 'premium'\)/u);
  assert.match(migration, /having v_plan = 'free'/u);
  assert.match(migration, /v_plan = 'premium'/u);
  assert.match(migration, /revoke execute on function public\.novelight_author_analytics_timeseries\(integer\) from public, anon/u);
  assert.match(migration, /grant execute on function public\.novelight_author_exposure_funnel_v2\(integer\) to authenticated/u);
});

test('analytics page explicitly distinguishes available plan features and beta prices', () => {
  assert.match(html, /id="analyticsPlanCompareTitle"/u);
  assert.match(html, /data-analytics-tier="free"/u);
  assert.match(html, /data-analytics-tier="standard"/u);
  assert.match(html, /data-analytics-tier="premium"/u);
  assert.match(html, /Standard 0円・Premium 月額480円/u);
  assert.match(html, /別の日の閲覧も継続として扱います/u);
  assert.match(runtime, /currentAnalyticsPlan/u);
  assert.match(runtime, /cell\.dataset\.analyticsTier === plan/u);
});

test('historical 16-day continuation and Free/Standard boundaries are exercised in replay', () => {
  assert.match(replay, /tests\/rls\/light-analytics-cross-visit\.sql/u);
  assert.match(replay, /20261110172000_author_reader_retention_cross_visit_postcheck\.sql/u);
  assert.match(fixture, /interval '20 days'/u);
  assert.match(fixture, /interval '4 days'/u);
  assert.match(fixture, /v_first <> 2 or v_second <> 1 or v_rate <> 50/u);
  assert.match(fixture, /set plan='standard'/u);
  assert.match(fixture, /rollback;/u);
});
