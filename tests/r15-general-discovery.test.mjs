import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('R15 is in general discovery; AI-generated and R18 remain isolated', async () => {
  const sql = await read(
    '../supabase/migrations/20261012010000_merge_r15_general_discovery.sql'
  );
  assert.match(sql, /when p_content_rating = 'adult_18_nonsexual' then 'r18'/);
  assert.match(sql, /when p_ai_usage = 'ai_generated' then 'ai'/);
  assert.doesNotMatch(sql, /when p_content_rating = 'sensitive_15' then 'r15'/);
  assert.match(sql, /novelight_is_light_seed_eligible/);
  assert.match(sql, /p_content_rating = 'general'/);
  for (const sig of [
    'novelight_light_seed_feed',
    'light_seed_status_auto_v1',
    'plant_light_seed_auto_v1',
    'light_seed_status_v2',
    'plant_light_seed_v2'
  ]) {
    assert.ok(sql.includes(sig), sig);
  }
  assert.match(sql, /R15 discovery\/SEED invariants failed/);
});

test('standalone R15 navigation retires without breaking legacy links', async () => {
  const landing = await read('../special-light.html');
  const zone = await read('../special-zone.html');
  assert.doesNotMatch(landing, /special-zone\.html\?zone=r15/);
  assert.match(landing, /special-zone\.html\?zone=ai/);
  assert.match(landing, /special-zone\.html\?zone=r18/);
  assert.match(zone, /location\.replace\('search\.html'\)/);
  assert.match(zone, /new Set\(\['ai','r18'\]\)/);
});

test('R15 badges, preference and existing detail/episode gates remain', async () => {
  const [filter, search, novel, episode] = await Promise.all([
    read('../novelight-r15-discovery.js'),
    read('../search.html'),
    read('../novel.html'),
    read('../episode.html')
  ]);
  assert.match(filter, /R15作品を表示しない/);
  assert.match(filter, /novelight_search_card_metadata/);
  assert.match(search, /sensitive_15/);
  assert.match(novel, /rating==='sensitive_15'/);
  assert.match(episode, /rating==='sensitive_15'/);
});

test('rollback restores previous isolation and LIGHT SEED guards', async () => {
  const rollback = await read(
    '../supabase/rollback/20261012010000_merge_r15_general_discovery_rollback.sql'
  );
  assert.match(rollback, /then 'r15'/);
  assert.match(rollback, /novelight_is_general_discovery_eligible/);
  assert.match(
    rollback,
    /drop function public\.novelight_is_light_seed_eligible/
  );
});
