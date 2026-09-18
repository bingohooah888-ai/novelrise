import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const version = '20260918235120';
const migration = await readFile(
  `supabase/migrations/${version}_reader_history_stats.sql`,
  'utf8'
);
const precheck = await readFile(
  `supabase/checks/${version}_reader_history_stats_precheck.sql`,
  'utf8'
);
const postcheck = await readFile(
  `supabase/checks/${version}_reader_history_stats_postcheck.sql`,
  'utf8'
);
const rollback = await readFile(
  `supabase/rollback/${version}_reader_history_stats_rollback.sql`,
  'utf8'
);
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');
const runtime = await readFile('novelight-reading-history.js', 'utf8');
const page = await readFile('reading-history.html', 'utf8');
const favorites = await readFile('favorites.html', 'utf8');
const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');

test('B #17 reuses existing valid-read history instead of creating a second tracker', () => {
  assert.match(migration, /from public\.valid_read_events v/iu);
  assert.doesNotMatch(
    migration,
    /create table public\.(?:reader_history|reading_history|reader_read_events)/iu
  );
  assert.doesNotMatch(migration, /create trigger/iu);
});

test('reader history RPC is authenticated-only and current-reader-bound', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_reader_history_stats\([\s\S]*security definer[\s\S]*set search_path = ''/iu
  );
  assert.match(migration, /v_uid uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /v\.reader_id = v_uid/gu);
  assert.match(
    migration,
    /revoke all on function public\.novelight_reader_history_stats\(integer\)[\s\S]*from public, anon, authenticated, service_role/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_reader_history_stats\(integer\)[\s\S]*to authenticated/iu
  );
});

test('stats semantics remain honest about first valid reads and manual completed state', () => {
  assert.match(migration, /first_valid_read_day_count/u);
  assert.match(migration, /completed_marked_work_count/u);
  assert.match(migration, /first_valid_read_per_episode/u);
  assert.match(migration, /Asia\/Tokyo/u);
});

test('genre tendency counts distinct works instead of rewarding long serials', () => {
  assert.match(
    migration,
    /select distinct v\.novel_id_snapshot[\s\S]*group by n\.genre/iu
  );
});

test('history only returns content that is currently public', () => {
  assert.match(
    migration,
    /join public\.novels n[\s\S]*n\.status = 'published'/iu
  );
  assert.match(
    migration,
    /join public\.episodes e[\s\S]*e\.status = 'published'/iu
  );
});

test('B #17 aggregation is read-only and evaluation-neutral', () => {
  assert.doesNotMatch(
    migration,
    /insert into public\.|update public\.|delete from public\.|scout_xp_ledger|novel_exposure_events|recalculate_work_rank|send_light_seed/iu
  );
  assert.match(
    migration,
    /No new tracking and no evaluation, Rank, SCOUT, discovery, exposure, or author analytics effect/iu
  );
});

test('migration has precheck, postcheck, rollback, and replay coverage', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #17 private reader history prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #17 history is private, read-only, and evaluation-neutral/u
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_reader_history_stats\(integer\)/u
  );
  assert.match(
    replay,
    /Verify B #17 private reader history[\s\S]*20260918235120_reader_history_stats_rollback\.sql[\s\S]*20260918235120_reader_history_stats\.sql/iu
  );
});

test('reader UI explains private first-valid-read semantics without public sharing', () => {
  assert.match(page, /読書記録/u);
  assert.match(runtime, /この記録は自分だけに表示されます/u);
  assert.match(runtime, /同じ話の読み直しは重複記録せず/u);
  assert.match(runtime, /読了にした作品/u);
  assert.match(runtime, /作者向け分析には使用しません/u);
  assert.match(favorites, /reading-history\.html/u);
  assert.doesNotMatch(page + runtime, /公開プロフィールに表示|共有設定/u);
});

test('reader page uses the shared browser bootstrap and fails closed before DB rollout', () => {
  assert.match(page, /novelight-client\.js/u);
  assert.match(page, /assets\/novelight-header-logo\.webp/u);
  assert.match(runtime, /PGRST202/u);
  assert.match(runtime, /データベース反映待ち/u);
  assert.doesNotMatch(runtime, /\.from\(['"]valid_read_events['"]\)/u);
});

test('MASTER fixes B #17 to existing valid-read data and private beta presentation', () => {
  assert.match(master, /本人専用の読書履歴・個人読書統計/u);
  assert.match(master, /valid_read_events/u);
  assert.match(master, /第二の読書トラッカーや追加の閲覧イベントを新設しない/u);
  assert.match(master, /公開プロフィール機能にしない/u);
  assert.match(
    master,
    /Production migrationの適用は、PR mergeとは別の明示承認境界/u
  );
});
