import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  "supabase/migrations/20260917040000_novel_series.sql",
  "utf8",
);
const rollback = await readFile(
  "supabase/rollback/20260917040000_novel_series_rollback.sql",
  "utf8",
);
const seriesRuntime = await readFile("novelight-series.js", "utf8");
const seriesPage = await readFile("series.html", "utf8");
const novelPage = await readFile("novel.html", "utf8");
const myNovelsPage = await readFile("my-novels.html", "utf8");

test("series tables keep raw anonymous reads private", () => {
  assert.match(migration, /create table public\.novel_series \(/);
  assert.match(migration, /create table public\.novel_series_items \(/);
  assert.match(
    migration,
    /alter table public\.novel_series enable row level security/,
  );
  assert.match(
    migration,
    /alter table public\.novel_series_items enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_series from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_series_items from public, anon, authenticated/,
  );
  assert.match(migration, /create policy novel_series_insert_owner/);
  assert.match(migration, /create policy novel_series_items_insert_owner/);
  assert.match(migration, /n\.user_id = \(select auth\.uid\(\)\)/);
});

test("series membership is bounded to one series per work", () => {
  assert.match(
    migration,
    /constraint novel_series_items_novel_once unique \(novel_id\)/,
  );
  assert.match(
    migration,
    /constraint novel_series_items_position_once unique \(series_id, position\)/,
  );
  assert.match(migration, /if v_count > 100 then/);
  assert.match(migration, /NOVEL_ALREADY_IN_SERIES/);
  assert.match(migration, /SERIES_ITEM_DUPLICATE/);
});

test("public context hides unpublished works from readers", () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_public_series_context/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /n\.status = 'published'/);
  assert.match(migration, /n\.user_id = auth\.uid\(\)/);
  assert.match(
    migration,
    /grant execute on function public\.novelight_public_series_context\(bigint\) to anon, authenticated/,
  );
  assert.doesNotMatch(migration, /grant select[^;]*novel_series[^;]*to anon/i);
});

test("series remain navigation metadata rather than a scoring unit", () => {
  assert.doesNotMatch(migration, /\bpv\s+(?:bigint|integer)/i);
  assert.doesNotMatch(migration, /\bfavorites?\s+(?:bigint|integer)/i);
  assert.doesNotMatch(migration, /work_rank/i);
  assert.doesNotMatch(migration, /light_seed/i);
  assert.match(migration, /Not an evaluation or exposure unit/);
});

test("work pages mount ordered series context and navigation", () => {
  assert.match(seriesRuntime, /novelight_public_series_context/);
  assert.match(seriesRuntime, /前の作品/);
  assert.match(seriesRuntime, /次の作品/);
  assert.match(seriesRuntime, /item_position/);
  assert.match(novelPage, /novelight-series\.js/);
  assert.match(novelPage, /NovelightSeries\.mountNovelContext/);
});

test("authors can create edit order and remove series membership", () => {
  assert.match(seriesPage, /シリーズ管理/);
  assert.match(seriesPage, /client\.from\('novel_series'\)\.insert/);
  assert.match(seriesPage, /novelight_set_series_items/);
  assert.match(seriesPage, /move-up/);
  assert.match(seriesPage, /move-down/);
  assert.match(seriesPage, /remove-work/);
  assert.match(myNovelsPage, /series\.html/);
});

test("rollback removes series functions before the tables", () => {
  const publicFunctionIndex = rollback.indexOf(
    "drop function if exists public.novelight_public_series_context",
  );
  const mutationFunctionIndex = rollback.indexOf(
    "drop function if exists public.novelight_set_series_items",
  );
  const itemTableIndex = rollback.indexOf(
    "drop table if exists public.novel_series_items",
  );
  assert.ok(publicFunctionIndex >= 0);
  assert.ok(mutationFunctionIndex >= 0);
  assert.ok(itemTableIndex > publicFunctionIndex);
  assert.ok(itemTableIndex > mutationFunctionIndex);
});
