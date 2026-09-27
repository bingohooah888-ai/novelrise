import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260928004000_special_light_zones.sql',
  import.meta.url
);
const landingPath = new URL('../special-light.html', import.meta.url);
const zonePath = new URL('../special-zone.html', import.meta.url);
const homeLoaderPath = new URL('../novelight-special-light-home.js', import.meta.url);
const authContextPath = new URL('../auth-reader-context.js', import.meta.url);

test('special-light zoning preserves R18 > R15 > AI > general precedence', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  const r18 = sql.indexOf("when p_content_rating = 'adult_18_nonsexual' then 'r18'");
  const r15 = sql.indexOf("when p_content_rating = 'sensitive_15' then 'r15'");
  const ai = sql.indexOf("when p_ai_usage = 'ai_generated' then 'ai'");
  const general = sql.indexOf("else 'general'");

  assert.ok(r18 >= 0 && r15 > r18 && ai > r15 && general > ai);
  assert.match(sql, /novelight_is_general_discovery_eligible/);
});

test('ordinary discovery and LIGHT SEED are hardened server-side', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  for (const signature of [
    'novelight_discovery_feed_v2',
    'novelight_plan_extra_feed',
    'novelight_neutral_search',
    'novelight_light_seed_feed',
    'novelight_beta_rank_discovery_feed',
    'novelight_ranking_feed_v2',
    'light_seed_status_auto_v1',
    'plant_light_seed_auto_v1'
  ]) {
    assert.ok(sql.includes(signature), `${signature} must be hardened`);
  }

  assert.match(sql, /This work is not eligible for LIGHT SEED/);
});

test('special-zone feed has separate recommendation and ranking modes without LIGHT SEED', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /novelight_special_zone_feed_v1/);
  assert.match(sql, /v_mode not in \('recommended', 'ranking'\)/);
  assert.match(sql, /novel_star_ratings/);
  assert.match(sql, /valid_read_events/);
  assert.doesNotMatch(sql, /light_seed_count/);
});

test('public special-light navigation exposes AI, R15 and R18 zones', async () => {
  const [landing, zonePage, homeLoader, authContext] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(zonePath, 'utf8'),
    readFile(homeLoaderPath, 'utf8'),
    readFile(authContextPath, 'utf8')
  ]);

  assert.match(landing, /もうひとつの光を探す/);
  assert.match(landing, /special-zone\.html\?zone=ai/);
  assert.match(landing, /special-zone\.html\?zone=r15/);
  assert.match(landing, /special-zone\.html\?zone=r18/);
  assert.match(zonePage, />おすすめ</);
  assert.match(zonePage, />ランキング</);
  assert.match(zonePage, /ジャンルで絞り込む/);
  assert.match(zonePage, /LIGHT SEEDは利用できません/);
  assert.match(homeLoader, /もうひとつの光を探す/);
  assert.match(authContext, /novelight-special-light-home\.js/);
});
