import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mypage = readFileSync('mypage.html', 'utf8');
const publicProfile = readFileSync('author.html', 'utf8');
const moduleSource = readFileSync('novelight-profile-favorite-genres.js', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20261018120000_profile_favorite_genres.sql',
  'utf8'
);
const postcheck = readFileSync(
  'supabase/checks/20261018120000_profile_favorite_genres_postcheck.sql',
  'utf8'
);

test('profile editor offers ten canonical genres and independent save', () => {
  assert.match(mypage, /id="favoriteGenreChoices"/u);
  assert.match(mypage, /id="favoriteGenresPublic" type="checkbox" disabled/u);
  assert.match(mypage, /id="saveFavoriteGenres"/u);
  assert.match(mypage, /mountEditor\(client\)/u);
  assert.match(moduleSource, /const MAX = 3/u);
  for (const genre of ['異世界ファンタジー', '現代ファンタジー', '恋愛', 'ラブコメ', 'SF', 'ミステリー', 'ホラー', '歴史', '現代ドラマ', 'その他']) {
    assert.ok(moduleSource.includes(genre));
  }
});

test('favorite genres default to nonpublic and use owner-only validated writes', () => {
  assert.match(migration, /is_public boolean not null default false/u);
  assert.match(migration, /cardinality\(genres\) <= 3/u);
  assert.match(migration, /count\(distinct genre\)/u);
  assert.match(migration, /v_uid uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /enable row level security/u);
  assert.match(postcheck, /has_table_privilege/u);
  assert.match(postcheck, /has_function_privilege/u);
});

test('public author page shows selected genres only after opt-in', () => {
  assert.match(publicProfile, /mountPublic\(/u);
  assert.match(moduleSource, /novelight_public_favorite_genres/u);
  assert.match(moduleSource, /document\.createElement\('span'\)/u);
  assert.match(migration, /p\.is_public=true/u);
  assert.match(migration, /n\.status='published'/u);
  assert.match(migration, /to anon,authenticated/u);
});
