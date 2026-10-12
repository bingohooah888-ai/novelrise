import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('R15 no longer has a rating-based recommendation quota', async () => {
  const [runtime, list] = await Promise.all([
    read('../novelight-r15-discovery.js'),
    read('../novelight-discovery-list.js')
  ]);
  assert.doesNotMatch(runtime, /mixRecommendedRows/);
  assert.doesNotMatch(list, /mixRecommendedRows/);
  assert.match(runtime, /R15作品を表示しない/);
});

test('the shared ranking removes R15-specific ordering', async () => {
  const sql = await read(
    '../supabase/migrations/20261012103000_r15_parity_light_seed.sql'
  );
  assert.match(sql, /rating_ranked as materialized/);
  assert.match(sql, /from ranked r/);
  assert.match(sql, /execute v_definition/);
});

test('R15 LIGHT SEED has the same eligibility as general', async () => {
  const sql = await read(
    '../supabase/migrations/20261012103000_r15_parity_light_seed.sql'
  );
  assert.match(sql, /p_content_rating in \('general', 'sensitive_15'\)/);
  assert.match(sql, /coalesce\(p_ai_usage, ''\) <> 'ai_generated'/);
  assert.match(sql, /public\.plant_light_seed_auto_v1\(text\)/);
  assert.match(sql, /public\.light_seed_status_auto_v1\(text\)/);
});
