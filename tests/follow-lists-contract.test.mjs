import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = file => readFileSync(path.join(root, file), 'utf8');

test('bookshelf and community both navigate to the following tab', () => {
  for (const file of ['favorites.html', 'community.html']) {
    assert.match(source(file), /href="following\.html\?tab=following">フォロー中<\/a>/);
  }
});

test('follow screen has X-style accessible followers and following tabs', () => {
  const html = source('following.html');
  assert.match(html, /role="tablist" aria-label="フォローの種類"/);
  assert.match(html, /id="followersTab"[^>]*role="tab"[^>]*data-follow-view="followers"/);
  assert.match(html, /id="followingTab"[^>]*role="tab"[^>]*data-follow-view="following"/);
  assert.match(html, /id="followingList"[^>]*role="tabpanel"/);
  assert.match(html, /id="followersCount"/);
  assert.match(html, /id="followingCount"/);
  assert.match(html, /novelight-accessibility\.css/);
});

test('follow screen uses authenticated scoped RPCs, not raw relationship table access', () => {
  const js = source('novelight-following-list.js');
  assert.doesNotThrow(() => new Script(js));
  assert.match(js, /novelight_followers/);
  assert.match(js, /novelight_followed_authors/);
  assert.match(js, /novelight_follow_counts/);
  assert.match(js, /client\.auth\.getSession\(\)/);
  assert.match(js, /revision !== requestRevision/);
  assert.match(js, /event\.key/);
  assert.doesNotMatch(js, /\.from\(['"]author_follows['"]\)/);
});

test('follow RPCs enforce caller identity, relation scoping and block filtering', () => {
  const sql = source('supabase/migrations/20261031173000_followed_authors_list.sql');
  for (const name of [
    'novelight_followed_authors',
    'novelight_followers',
    'novelight_follow_counts'
  ]) {
    const pattern = new RegExp('create function public\\.' + name + '\\([^]*?\\n\\$\\$;');
    const match = sql.match(pattern);
    assert.ok(match, 'missing RPC ' + name);
    assert.match(match[0], /v_uid uuid := \(select auth\.uid\(\)\)/);
    assert.match(match[0], /if v_uid is null then/);
    assert.match(sql, new RegExp('grant execute on function public\\.' + name + '\\('));
  }
  assert.match(sql, /where f\.author_user_id = v_uid/);
  assert.match(sql, /where f\.follower_user_id = v_uid/);
  assert.match(sql, /from public\.user_blocks/);
  assert.match(sql, /revoke all on function public\.novelight_followers\(integer,integer\)/);
  assert.match(sql, /revoke all on function public\.novelight_follow_counts\(\)/);
  assert.doesNotMatch(sql, /grant select on public\.author_follows/i);
});
