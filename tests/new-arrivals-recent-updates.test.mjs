import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('../index.html');
const list = read('../novelight-discovery-list.js');
const migration = read(
  '../supabase/migrations/20261013221000_recent_updates_feed.sql'
);

test('both new-arrivals surfaces use the recent-updates feed', () => {
  assert.match(home, /client\.rpc\('novelight_recent_updates_feed'/u);
  assert.match(list, /client\.rpc\('novelight_recent_updates_feed'/u);
  assert.match(list, /p_offset: neutralOffset/u);
  assert.match(list, /neutralOffset \+= rows\.length/u);
  assert.match(list, /p_limit: limit/u);
  assert.match(
    home,
    /missingTrustedRpc\(updated\.error,\s*'novelight_recent_updates_feed'\)/u
  );
  assert.match(
    list,
    /shouldFallbackFeed\(result, 'novelight_recent_updates_feed'\)/u
  );
  assert.match(home, /p_sort:'new'/u);
  assert.match(list, /p_sort: 'new'/u);
});

test('latest published episode drives safe ordering', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_recent_updates_feed\(/u
  );
  assert.match(migration, /n\.status = 'published'/u);
  assert.match(migration, /novelight_is_general_discovery_eligible/u);
  assert.match(migration, /e\.status = 'published'/u);
  assert.match(migration, /e\.scheduled_publish_at <= now\(\)/u);
  assert.match(
    migration,
    /max\(coalesce\(e\.first_published_at, e\.created_at\)\)/u
  );
  assert.match(
    migration,
    /order by\s+c\.last_published_at desc,\s+c\.created_at desc,\s+c\.novel_id asc/u
  );
  assert.match(
    migration,
    /limit least\(greatest\(coalesce\(p_limit, 24\), 1\), 100\)/u
  );
  assert.match(migration, /to anon, authenticated;/u);
  assert.doesNotMatch(migration, /join public\.profiles/u);
});

test('cards do not gain an initial-publication label', () => {
  assert.match(list, /最終投稿日：/u);
  assert.doesNotMatch(list, /初回公開日：/u);
  assert.match(home, /<h2>新着作品<\/h2>/u);
});
