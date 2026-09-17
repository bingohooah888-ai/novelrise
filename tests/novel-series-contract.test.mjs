import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260918060000_novel_series.sql';
const migration = await readFile(migrationPath, 'utf8');
const precheck = await readFile(
  'supabase/checks/20260918060000_novel_series_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918060000_novel_series_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918060000_novel_series_rollback.sql',
  'utf8'
);
const seriesRuntime = await readFile('novelight-series.js', 'utf8');
const seriesPage = await readFile('series.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const myNovelsPage = await readFile('my-novels.html', 'utf8');

test('fresh migration is fail-closed and series tables keep raw anonymous reads private', () => {
  assert.match(migrationPath, /20260918060000_novel_series/);
  assert.match(migration, /Required public\.novels table is missing/);
  assert.match(migration, /RLS must be enabled on public\.novels/);
  assert.match(migration, /Novel series tables already exist/);
  assert.match(migration, /Novel series RPC already exists/);
  assert.match(migration, /create table public\.novel_series \(/);
  assert.match(migration, /create table public\.novel_series_items \(/);
  assert.match(
    migration,
    /alter table public\.novel_series enable row level security/
  );
  assert.match(
    migration,
    /alter table public\.novel_series_items enable row level security/
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_series from public, anon, authenticated/
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_series_items from public, anon, authenticated/
  );
  assert.match(migration, /create policy novel_series_insert_owner/);
  assert.match(migration, /create policy novel_series_items_insert_owner/);
  assert.match(migration, /n\.user_id = \(select auth\.uid\(\)\)/);
});

test('series membership is bounded to one series per work and writes are RPC-only', () => {
  assert.match(
    migration,
    /constraint novel_series_items_novel_once unique \(novel_id\)/
  );
  assert.match(
    migration,
    /constraint novel_series_items_position_once unique \(series_id, position\)/
  );
  assert.match(migration, /if v_count > 100 then/);
  assert.match(migration, /NOVEL_ALREADY_IN_SERIES/);
  assert.match(migration, /SERIES_ITEM_DUPLICATE/);
  assert.match(
    migration,
    /grant select on table public\.novel_series_items to authenticated/
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*(?:insert|update|delete)[^;]*public\.novel_series_items[^;]*to authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_set_series_items\(bigint, bigint\[\]\)[\s\S]*to authenticated/
  );
});

test('public context hides unpublished works from readers', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_public_series_context/
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /n\.status = 'published'/);
  assert.match(migration, /n\.user_id = auth\.uid\(\)/);
  assert.match(
    migration,
    /grant execute on function public\.novelight_public_series_context\(bigint\)[\s\S]*to anon, authenticated/
  );
  assert.doesNotMatch(migration, /grant select[^;]*novel_series[^;]*to anon/i);
});

test('series remain navigation metadata rather than a scoring unit', () => {
  assert.doesNotMatch(migration, /\bpv\s+(?:bigint|integer)/i);
  assert.doesNotMatch(migration, /\bfavorites?\s+(?:bigint|integer)/i);
  assert.doesNotMatch(migration, /work_rank/i);
  assert.doesNotMatch(migration, /light_seed/i);
  assert.match(migration, /Not an evaluation or exposure unit/);
});

test('work pages mount ordered series context and navigation', () => {
  assert.match(seriesRuntime, /novelight_public_series_context/);
  assert.match(seriesRuntime, /前の作品/);
  assert.match(seriesRuntime, /次の作品/);
  assert.match(seriesRuntime, /item_position/);
  assert.match(novelPage, /novelight-series\.js/);
  assert.match(novelPage, /NovelightSeries\.mountNovelContext/);
});

test('authors can create edit order and remove series membership', () => {
  assert.match(seriesPage, /シリーズ管理/);
  assert.match(seriesPage, /client\.from\('novel_series'\)\.insert/);
  assert.match(seriesPage, /novelight_set_series_items/);
  assert.match(seriesPage, /move-up/);
  assert.match(seriesPage, /move-down/);
  assert.match(seriesPage, /remove-work/);
  assert.match(myNovelsPage, /series\.html/);
});

test('code-first rollout keeps existing author backup and fails closed before migration', () => {
  assert.match(myNovelsPage, /novelight-author-work-export\.js/);
  assert.match(myNovelsPage, /TXTバックアップ/);
  assert.match(myNovelsPage, /NovelightAuthorWorkExport\.mount/);
  assert.match(myNovelsPage, /id="seriesLink" hidden/);
  assert.match(myNovelsPage, /novelight_public_series_context/);
  assert.match(seriesPage, /シリーズ機能は現在準備中です/);
  assert.match(seriesRuntime, /series context unavailable/);
});

test('precheck and postcheck enforce expected Production security contract', () => {
  assert.match(precheck, /Novel series tables already exist/);
  assert.match(postcheck, /RLS is not enabled on novel series tables/);
  assert.match(postcheck, /anon must not have raw series table access/);
  assert.match(postcheck, /authenticated series table grants are incomplete/);
  assert.match(
    postcheck,
    /authenticated series membership writes must use the bounded RPC/
  );
  assert.match(postcheck, /authenticated must execute author series mutation RPC/);
  assert.match(postcheck, /anon must not execute author series mutation RPC/);
});

test('rollback refuses destructive removal after series data exists', () => {
  const guardIndex = rollback.indexOf(
    'Refusing novel series rollback while series data exists'
  );
  const publicFunctionIndex = rollback.indexOf(
    'drop function if exists public.novelight_public_series_context'
  );
  const mutationFunctionIndex = rollback.indexOf(
    'drop function if exists public.novelight_set_series_items'
  );
  const itemTableIndex = rollback.indexOf(
    'drop table if exists public.novel_series_items'
  );
  assert.ok(guardIndex >= 0);
  assert.ok(publicFunctionIndex > guardIndex);
  assert.ok(mutationFunctionIndex > guardIndex);
  assert.ok(itemTableIndex > publicFunctionIndex);
  assert.ok(itemTableIndex > mutationFunctionIndex);
});
