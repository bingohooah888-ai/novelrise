import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = 'supabase/migrations/20261027090000_remove_star_ratings_and_schedule_work_ranks.sql';
const master = 'docs/NOVELIGHT-MASTER.md';
const precheck = 'supabase/checks/20261027090000_remove_star_ratings_and_schedule_work_ranks_precheck.sql';
const postcheck = 'supabase/checks/20261027090000_remove_star_ratings_and_schedule_work_ranks_postcheck.sql';

test('Rank no longer needs star-rating metrics; original reader/favorite floors remain', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /novelight_rank_absolute_ceiling_v3\(/);
  for (const condition of [
    '>= 50 and coalesce(p_favorites, 0) >= 2',
    '>= 200 and coalesce(p_favorites, 0) >= 8',
    '>= 800 and coalesce(p_favorites, 0) >= 30',
    '>= 3000 and coalesce(p_favorites, 0) >= 100',
    '>= 10000 and coalesce(p_favorites, 0) >= 300',
  ]) {
    assert.ok(sql.includes(condition), condition);
  }
  assert.match(sql, /20\.0 \* greatest\(/);
  assert.match(sql, /35\.0 \* greatest\(/);
  assert.match(sql, /\) \/ 55\.0/);
  const evaluator = sql.split('-- Existing rank lifecycle body, with ONLY star-derived inputs removed.')[1]
    .split('-- Preserve special-zone RPC return fields')[0];
  assert.ok(evaluator.includes('novelight_recalculate_work_ranks'));
  assert.ok(evaluator.includes('novelight_rank_internal_score_v3('));
  assert.ok(evaluator.includes('novelight_rank_absolute_ceiling_v3('));
  assert.ok(evaluator.includes('last_evaluated_at = p_now'));
  assert.equal(/novel_star_ratings|bayesian_rating|rating_count|rating_average/i.test(evaluator), false);
});

test('cron schedules private evaluation, not migration-time Rank mutation', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /'novelight-recalculate-work-ranks'/);
  assert.match(sql, /'15 \* \* \* \*'/);
  assert.match(sql, /select public\.novelight_recalculate_work_ranks\(\);/);
  assert.equal(/\bselect\s+public\.novelight_recalculate_work_ranks\(\)\s*;/i.test(sql), false);
  assert.match(sql, /drop table public\.novel_star_ratings restrict;/);
  assert.match(sql, /drop function if exists public\.set_novel_star_rating/);
  assert.match(sql, /earned_at is not null/);
});

test('master, precheck, and postcheck track the starless operational contract', async () => {
  const [doc, pre, post] = await Promise.all([readFile(master,'utf8'),readFile(precheck,'utf8'),readFile(postcheck,'utf8')]);
  assert.match(doc,/2026年10月27日追補：作品成長Rankの星評価仕様を撤廃/);
  assert.match(doc,/有効読者数パーセンタイル × 20\/55/);
  assert.match(doc,/お気に入りパーセンタイル × 35\/55/);
  assert.match(pre,/historical_star_ratings/);
  assert.match(post,/last_evaluated_at/);
  assert.match(post,/cron\.job_run_details/);
});
