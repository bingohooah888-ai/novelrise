import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260927153000_special_light_zones.sql', import.meta.url),
  'utf8'
);
const selectorPage = readFileSync(
  new URL('../special-light.html', import.meta.url),
  'utf8'
);
const zonePage = readFileSync(
  new URL('../special-light-zone.html', import.meta.url),
  'utf8'
);
const homeLoader = readFileSync(
  new URL('../auth-reader-context.js', import.meta.url),
  'utf8'
);
const homeGateway = readFileSync(
  new URL('../novelight-special-light-home.js', import.meta.url),
  'utf8'
);

test('special-light zone precedence is R18 > R15 > AI > general', () => {
  const r18 = migration.indexOf("= 'adult_18_nonsexual' then 'r18'");
  const r15 = migration.indexOf("= 'sensitive_15' then 'r15'");
  const ai = migration.indexOf("= 'ai_generated' then 'ai'");
  const general = migration.indexOf("in ('human', 'ai_assisted') then 'general'");

  assert.ok(r18 >= 0);
  assert.ok(r15 > r18);
  assert.ok(ai > r15);
  assert.ok(general > ai);
});

test('normal discovery and LIGHT SEED are server-side gated', () => {
  for (const signature of [
    'novelight_neutral_search',
    'novelight_ranking_feed',
    'novelight_discovery_feed_v2',
    'novelight_plan_extra_feed',
    'novelight_light_seed_feed',
    'novelight_beta_rank_discovery_feed'
  ]) {
    assert.match(migration, new RegExp(signature));
  }

  assert.match(migration, /novelight_is_general_discovery_work/);
  assert.match(migration, /SPECIAL_LIGHT_ZONE_LIGHT_SEED_DISABLED/);
  assert.match(migration, /'reason', 'special_light_zone'/);
});

test('dedicated zones expose search, recommendation and ranking without LIGHT SEED', () => {
  assert.match(migration, /novelight_special_light_feed/);
  assert.match(migration, /p_mode text default 'recommended'/);
  assert.match(migration, /params\.mode = 'ranking'/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('create or replace function public.novelight_special_light_feed')),
    /light_seed_count/
  );

  assert.match(selectorPage, /AI作品/);
  assert.match(selectorPage, /R15/);
  assert.match(selectorPage, /R18/);
  assert.match(zonePage, />おすすめ</);
  assert.match(zonePage, />ランキング</);
  assert.match(zonePage, /すべてのジャンル/);
});

test('home loads the another-light gateway after ordinary discovery shelves', () => {
  assert.match(homeLoader, /novelight-special-light-home\.js/);
  assert.match(homeGateway, /もうひとつの光を探す/);
  assert.match(homeGateway, /gatheringShelfSection/);
  assert.match(homeGateway, /insertAdjacentElement\('afterend'/);
});
