import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const js = readFileSync('novelight-scout-record.js', 'utf8');
const html = readFileSync('scout-record.html', 'utf8');
const css = readFileSync('novelight-scout-record.css', 'utf8');
const share = readFileSync('novelight-x-image-share.js', 'utf8');
const sql = readFileSync(
  'supabase/migrations/20261015011500_scout_unified_activity_feed.sql',
  'utf8'
);

test('five activity filters and paginated timeline replace duplicate seed list', () => {
  for (const kind of ['all', 'read', 'favorite', 'seed', 'share']) {
    assert.match(html, new RegExp('data-activity-filter="' + kind + '"'));
  }
  assert.match(js, /novelight_scout_activity_feed/u);
  assert.match(js, /activityPageSize \+ 1/u);
  assert.match(html, /id="activityMore"/u);
  assert.match(css, /#activityList\{max-height:/u);
  assert.doesNotMatch(html, /id="seedHistoryList"/u);
  assert.doesNotMatch(js, /loadSeedHistory\(/u);
});

test('all historic LIGHT SEED records remain accessible', () => {
  assert.match(sql, /from public\.light_seeds s/u);
  assert.match(sql, /s\.reader_id = \(select auth\.uid\(\)\)/u);
  assert.match(sql, /p_kind = 'seed'/u);
  assert.match(js, /row\.seed_type/u);
});

test('X records composer openings, not alleged published posts', () => {
  assert.match(share, /'x_share_open', novelId/u);
  assert.match(sql, /'x_share_open'/u);
  assert.match(js, /X共有画面を開きました/u);
  assert.doesNotMatch(js, /Xに投稿しました/u);
});

test('activity feed uses authenticated user data only', () => {
  assert.match(sql, /Authentication required/u);
  assert.match(sql, /j\.user_id = \(select auth\.uid\(\)\)/u);
  assert.match(sql, /e\.user_id = \(select auth\.uid\(\)\)/u);
  assert.match(sql, /to authenticated;/u);
});
