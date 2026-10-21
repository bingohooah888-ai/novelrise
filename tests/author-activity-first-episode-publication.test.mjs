import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const file =
  'supabase/migrations/20261022010100_author_activity_first_episode.sql';
const sql = await readFile(file, 'utf8');

test('legacy first episode uses work initial publication only when valid', () => {
  assert.match(sql, /n\.first_published_at as novel_first_published_at/u);
  assert.match(sql, /e\.episode_number = 1/u);
  assert.match(sql, /o\.novel_first_published_at >= e\.created_at/u);
  assert.match(sql, /then o\.novel_first_published_at/u);
  assert.match(sql, /then 'episode_published'::text/u);
  assert.match(sql, /else 'episode_added'::text/u);
});

test('explicit episode timestamps and valid follower events win', () => {
  assert.match(
    sql,
    /coalesce\(\s*e\.first_published_at,\s*fe\.occurred_at,\s*case/u
  );
  assert.match(sql, /fe\.episode_id = e\.id/u);
  assert.match(sql, /fe\.author_user_id = v_uid/u);
  assert.match(sql, /fe\.event_type = 'episode_published'/u);
  assert.match(sql, /e\.user_id = v_uid/u);
  assert.match(sql, /e\.status = 'published'/u);
  assert.match(sql, /v_uid uuid := \(select auth\.uid\(\)\)/u);
});

test('same display-window clock, read-only data, permissions and activities', () => {
  assert.match(sql, />= now\(\) - make_interval\(days => p_days\)/u);
  assert.match(sql, /p_days < 1 or p_days > 90/u);
  assert.match(sql, /p_limit < 1 or p_limit > 30/u);
  assert.match(sql, /union all select \* from episode_publication/u);
  assert.match(sql, /union all select \* from seeds_received/u);
  assert.match(sql, /union all select \* from favorites_received/u);
  assert.match(sql, /order by a\.occurred_at desc/u);
  assert.doesNotMatch(sql, /\bupdate\s+public\.episodes\b/iu);
  assert.doesNotMatch(sql, /\bupdate\s+public\.novels\b/iu);
  assert.match(
    sql,
    /revoke all on function public\.novelight_author_recent_activity_v1\(integer, integer\) from public, anon/u
  );
  assert.match(
    sql,
    /grant execute on function public\.novelight_author_recent_activity_v1\(integer, integer\) to authenticated/u
  );
});
