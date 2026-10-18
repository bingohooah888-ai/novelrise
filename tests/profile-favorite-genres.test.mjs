import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('mypage.html', 'utf8');
const author = readFileSync('author.html', 'utf8');
const moduleJs = readFileSync('novelight-profile-favorite-genres.js', 'utf8');
const sql = readFileSync(
  'supabase/migrations/20261018120000_profile_favorite_genres.sql',
  'utf8'
);

test('favorite genres have an independent, optional public setting', () => {
  assert.ok(page.includes('id="favoriteGenreChoices"'));
  assert.ok(page.includes('id="favoriteGenresPublic"'));
  assert.ok(page.includes('id="saveFavoriteGenres"'));
  assert.ok(moduleJs.includes('const MAX = 3'));
  assert.ok(author.includes('mountPublic'));
  assert.ok(sql.includes('is_public boolean not null default false'));
});

test('favorite genres are validated and protected by owner-only writes', () => {
  assert.ok(sql.includes('cardinality(v_genres) > 3'));
  assert.ok(sql.includes('count(distinct genre)'));
  assert.ok(sql.includes('v_uid uuid := (select auth.uid())'));
  assert.ok(sql.includes('enable row level security'));
  assert.ok(sql.includes('p.is_public=true'));
  assert.ok(sql.includes('to anon,authenticated'));
});
