import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [sql, page] = await Promise.all([
  readFile(
    'supabase/migrations/20261022010000_author_activity_publication_timestamps.sql',
    'utf8'
  ),
  readFile('mypage.html', 'utf8')
]);

test('published timestamp replaces draft creation time', () => {
  assert.match(sql, /e\.first_published_at is not null/u);
  assert.match(
    sql,
    /coalesce\(e\.first_published_at, fe\.occurred_at, e\.created_at\)/u
  );
  assert.match(sql, /then 'episode_published'::text/u);
  assert.match(sql, /else 'episode_added'::text/u);
  assert.doesNotMatch(sql, /e\.created_at\s*>=\s*now\(\)/u);
  assert.doesNotMatch(sql, /e\.updated_at/u);
});

test('legacy publication event must belong to the same author', () => {
  assert.match(sql, /left join public\.author_follow_events fe/u);
  assert.match(sql, /fe\.episode_id = e\.id/u);
  assert.match(sql, /fe\.author_user_id = v_uid/u);
  assert.match(sql, /fe\.event_type = 'episode_published'/u);
  assert.match(sql, /e\.user_id = v_uid/u);
  assert.match(sql, /e\.status = 'published'/u);
  assert.match(sql, /v_uid uuid := \(select auth\.uid\(\)\)/u);
});

test('activity limits and historical data remain intact', () => {
  assert.match(sql, /p_days < 1 or p_days > 90/u);
  assert.match(sql, /p_limit < 1 or p_limit > 30/u);
  assert.match(sql, /union all select \* from episode_publication/u);
  assert.match(sql, /order by a\.occurred_at desc/u);
  assert.match(sql, /limit p_limit/u);
  assert.doesNotMatch(sql, /\bupdate\s+public\.episodes\b/iu);
  assert.match(
    sql,
    /grant execute on function public\.novelight_author_recent_activity_v1\(integer, integer\) to authenticated/u
  );
  assert.match(
    sql,
    /revoke all on function public\.novelight_author_recent_activity_v1\(integer, integer\) from public, anon/u
  );
});

test('UI distinguishes publication from legacy addition', () => {
  assert.match(page, /row\.activity_type==='episode_published'/u);
  assert.match(page, /話を公開しました。/u);
  assert.match(page, /row\.activity_type==='episode_added'/u);
  assert.match(page, /話を追加しました。/u);
  assert.match(page, /episode_published:'assets\/author-room\//u);
  assert.match(page, /episode_added:'assets\/author-room\//u);
});
