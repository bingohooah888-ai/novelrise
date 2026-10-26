import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stem = '20261027090000_remove_star_ratings_and_schedule_work_ranks';
const migration = `supabase/migrations/${stem}.sql`;
const master = 'docs/NOVELIGHT-MASTER.md';
const precheck = `supabase/checks/${stem}_precheck.sql`;
const postcheck = `supabase/checks/${stem}_postcheck.sql`;

test('work Rank no longer requires stars', async () => {
  const sql = await readFile(migration, 'utf8');
  const floors = [
    '>= 50 and coalesce(p_favorites, 0) >= 2',
    '>= 200 and coalesce(p_favorites, 0) >= 8',
    '>= 800 and coalesce(p_favorites, 0) >= 30',
    '>= 3000 and coalesce(p_favorites, 0) >= 100',
    '>= 10000 and coalesce(p_favorites, 0) >= 300'
  ];
  for (const floor of floors) {
    assert.ok(sql.includes(floor), floor);
  }
  assert.match(sql, /20\.0 \* greatest\(/);
  assert.match(sql, /35\.0 \* greatest\(/);
  assert.match(sql, /\) \/ 55\.0/);
  const start = sql.indexOf('-- Existing rank lifecycle body');
  const end = sql.indexOf('-- Preserve special-zone RPC');
  const evaluator = sql.slice(start, end);
  assert.ok(evaluator.includes('novelight_recalculate_work_ranks'));
  assert.ok(evaluator.includes('novelight_rank_internal_score_v3('));
  assert.ok(evaluator.includes('novelight_rank_absolute_ceiling_v3('));
  assert.ok(evaluator.includes('last_evaluated_at = p_now'));
  assert.doesNotMatch(evaluator, /novel_star_ratings|bayesian_rating/i);
  assert.doesNotMatch(evaluator, /rating_count|rating_average/i);
});

test('cron evaluates Rank without an immediate migration backfill', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /'novelight-recalculate-work-ranks'/);
  assert.match(sql, /'15 \* \* \* \*'/);
  assert.match(sql, /select public\.novelight_recalculate_work_ranks\(\);/);
  const directRun = /^\s*select\s+public\.novelight_recalculate_work_ranks\(\)\s*;/im;
  assert.equal(directRun.test(sql), false);
  assert.match(sql, /drop table public\.novel_star_ratings restrict;/);
  assert.match(sql, /drop function if exists public\.set_novel_star_rating/);
  assert.match(sql, /earned_at is not null/);
});

test('master and checks retain internal health evidence', async () => {
  const documents = [master, precheck, postcheck];
  const [doc, pre, post] = await Promise.all(
    documents.map((file) => readFile(file, 'utf8'))
  );
  assert.match(doc, /2026年10月27日追補：作品成長Rankの星評価仕様を撤廃/);
  assert.match(doc, /有効読者数パーセンタイル × 20\/55/);
  assert.match(doc, /お気に入りパーセンタイル × 35\/55/);
  assert.match(pre, /historical_star_ratings/);
  assert.match(post, /last_evaluated_at/);
  assert.match(post, /cron\.job_run_details/);
});
