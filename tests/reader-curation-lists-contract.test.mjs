import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260919102000_reader_curation_lists.sql',
  'utf8'
);
const runtime = await readFile('novelight-curation.js', 'utf8');
const manager = await readFile('curation-lists.html', 'utf8');
const publicPage = await readFile('curation.html', 'utf8');
const favorites = await readFile('favorites.html', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('B #21 raw curation storage is private and RPC-only', () => {
  for (const table of ['reader_curation_lists', 'reader_curation_list_items']) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        'iu'
      )
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on table public\\.${table}[^;]*public, anon, authenticated, service_role`,
        'isu'
      )
    );
  }
  assert.match(
    migration,
    /share_token uuid not null default gen_random_uuid\(\)/iu
  );
  assert.match(migration, /reader_curation_lists_share_token_idx/iu);
});

test('B #21 list creation and membership are bounded and owner-managed', () => {
  assert.match(
    migration,
    /At most 20 curation lists are available during beta/u
  );
  assert.match(
    migration,
    /At most 50 novels are available per curation list during beta/u
  );
  assert.match(migration, /Only currently published novels can be added/u);
  assert.match(migration, /list\.owner_user_id = v_uid/iu);
  assert.match(migration, /for update/iu);
  assert.match(migration, /A curation list with this title already exists/u);
  assert.match(migration, /This novel is already in the curation list/u);
});

test('B #21 public sharing is token-bound, private-by-default, and link-only', () => {
  assert.match(migration, /visibility text not null default 'private'/u);
  assert.match(migration, /visibility in \('private', 'shared'\)/u);
  assert.match(
    migration,
    /where list\.share_token = p_share_token\s+and list\.visibility = 'shared'/iu
  );
  assert.match(migration, /novel\.status = 'published'/u);
  assert.match(publicPage, /meta name="robots" content="noindex,follow"/u);
  assert.match(publicPage, /meta name="referrer" content="no-referrer"/u);
  assert.match(manager, /共有URLを知っている人だけ/u);
  assert.match(manager, /共有URLを更新/u);
  assert.match(runtime, /novelight_rotate_my_curation_share_token/u);
  assert.doesNotMatch(publicPage, /ランキング|人気順/u);
});

test('B #21 UI fails safely before migration and avoids raw-table access', () => {
  assert.match(runtime, /42883|PGRST202/u);
  assert.match(manager, /データベース反映待ち/u);
  assert.match(publicPage, /データベース反映待ち/u);
  assert.doesNotMatch(runtime, /\.from\(['"]reader_curation/u);
  assert.doesNotMatch(manager, /\.from\(['"]reader_curation/u);
  assert.doesNotMatch(publicPage, /\.from\(['"]reader_curation/u);
  assert.match(runtime, /novelight_manage_my_curation_lists/u);
  assert.match(runtime, /novelight_public_reader_curation/u);
});

test('B #21 rendering uses DOM text nodes for user-controlled content', () => {
  assert.match(manager, /\.textContent=/u);
  assert.match(publicPage, /\.textContent=/u);
  assert.match(runtime, /textContent =/u);
  assert.doesNotMatch(
    publicPage,
    /innerHTML\s*=\s*.*(?:title|description|curator)/iu
  );
  assert.doesNotMatch(manager, /innerHTML\s*=\s*.*(?:title|description)/iu);
});

test('B #21 is reachable from the bookshelf and novel detail', () => {
  assert.match(favorites, /curation-lists\.html/u);
  assert.match(novel, /novelight-curation\.css/u);
  assert.match(novel, /novelight-curation\.js/u);
  assert.match(
    novel,
    /NovelightCuration\.mountNovelControl\(client,novel,session\)/u
  );
});

test('B #21 stays outside evaluation, discovery, and social power systems', () => {
  assert.doesNotMatch(
    migration,
    /insert into public\.(?:light_seeds|favorites|novel_exposure_events|author_follow_events|notifications)/iu
  );
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:scout_|analytics)|recalculate_work_rank/iu
  );
  assert.match(
    migration,
    /never affect Rank, LIGHT SEED, SCOUT,[\s\S]*PV, favorites, search order, discovery shelves, exposure, analytics, or recommendations/iu
  );
  assert.match(
    manager,
    /作品Rank・露出・LIGHT SEED・SCOUT・おすすめに影響しません/u
  );
  assert.match(
    publicPage,
    /作品Rank・露出・LIGHT SEED・SCOUT・おすすめに影響しません/u
  );
});

test('B #21 migration replay covers behavior and safe rollback', () => {
  assert.match(replay, /Verify B #21 reader curation lists/u);
  assert.match(replay, /tests\/rls\/reader-curation-lists\.sql/u);
  assert.match(replay, /20260919102000_reader_curation_lists_rollback\.sql/u);
});
