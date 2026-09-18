import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918152523_reader_bookshelf_organization.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918152523_reader_bookshelf_organization_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918152523_reader_bookshelf_organization_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918152523_reader_bookshelf_organization_rollback.sql',
  'utf8'
);
const runtime = await readFile('novelight-bookshelf.js', 'utf8');
const favoritesPage = await readFile('favorites.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const homePage = await readFile('index.html', 'utf8');
const updateRuntime = await readFile('novelight-favorite-updates.js', 'utf8');

test('private bookshelf storage is owner-scoped and explicitly exposed only to authenticated readers', () => {
  assert.match(migration, /create table public\.reader_bookshelf_entries/iu);
  assert.match(
    migration,
    /alter table public\.reader_bookshelf_entries enable row level security/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.reader_bookshelf_entries[\s\S]*from public, anon, authenticated/iu
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]*to authenticated/iu
  );
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(
      migration,
      new RegExp(
        `create policy reader_bookshelf_entries_${operation}_own`,
        'iu'
      )
    );
  }
  assert.match(migration, /\(select auth\.uid\(\)\) = user_id/iu);
  assert.match(
    migration,
    /n\.id = reader_bookshelf_entries\.novel_id[\s\S]*n\.status = 'published'/iu
  );
});

test('bookshelf metadata remains convenience-only and separate from evaluation systems', () => {
  assert.match(
    migration,
    /Private reader organization only; never an evaluation, Rank, LIGHT SEED, SCOUT, discovery, or exposure signal/u
  );
  assert.doesNotMatch(migration, /insert into public\.favorites/iu);
  assert.doesNotMatch(migration, /update public\.favorites/iu);
  assert.doesNotMatch(migration, /delete from public\.favorites/iu);
  assert.doesNotMatch(migration, /insert into public\.light_seeds/iu);
  assert.doesNotMatch(migration, /scout_xp_ledger/iu);
  assert.doesNotMatch(migration, /novel_exposure_events/iu);
  assert.match(runtime, /作品Rank、LIGHT SEED、SCOUT、露出には加点されません/u);
});

test('beta scope provides three reading states, one private list label, and a private memo', () => {
  assert.match(migration, /'want_to_read', 'reading', 'completed'/u);
  assert.match(
    migration,
    /char_length\(btrim\(list_name\)\) between 1 and 60/iu
  );
  assert.match(migration, /char_length\(memo\) <= 1000/iu);
  assert.match(runtime, /want_to_read: 'あとで読む'/u);
  assert.match(runtime, /reading: '読書中'/u);
  assert.match(runtime, /completed: '読了'/u);
  assert.match(runtime, /自分用リスト/u);
  assert.match(runtime, /自分だけに見えるメモ/u);
});

test('existing bookshelf and work page are extended instead of replacing favorite or reading continuity', () => {
  assert.match(favoritesPage, /<h1>本棚<\/h1>/u);
  assert.match(favoritesPage, /novelight-reading-continuity\.js/u);
  assert.match(favoritesPage, /novelight-bookshelf\.js/u);
  assert.match(novelPage, /novelight-reading-continuity\.js/u);
  assert.match(novelPage, /novelight-bookshelf\.js/u);
  assert.match(runtime, /\.from\('favorites'\)/u);
  assert.match(favoritesPage, /id="bookshelfStateFilter"/u);
  assert.match(runtime, /state === 'favorites'/u);
  assert.doesNotMatch(runtime, /reader_reading_progress/u);
});

test('rollout is safe before migration and mobile controls collapse to one column', () => {
  assert.match(runtime, /isMissingBookshelfTable/u);
  assert.match(favoritesPage, /本棚整理機能のデータベース反映待ち/u);
  assert.match(runtime, /@media\(max-width:640px\)/u);
  assert.match(runtime, /grid-template-columns:1fr/u);
  assert.match(runtime, /login\.html\?redirect=/u);
  assert.match(runtime, /waitFor\('#favoriteButton', 0\)/u);
});

test('reader navigation exposes the bookshelf on desktop, mobile, and update-center empty state', () => {
  assert.match(homePage, /<a href="favorites\.html">本棚<\/a>/u);
  assert.match(updateRuntime, /favorites\.textContent = '本棚を見る'/u);
});

test('migration has bounded checks and rollback refuses to destroy private user data', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: private bookshelf prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: reader bookshelf is private and organization-only/u
  );
  assert.match(
    rollback,
    /Rollback blocked: reader bookshelf contains private user data/u
  );
  assert.match(
    rollback,
    /drop table if exists public\.reader_bookshelf_entries/iu
  );
});
