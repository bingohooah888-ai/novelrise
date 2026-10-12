import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('recommendations use the same allocator for R15 and general', async () => {
  const [runtime, list, home] = await Promise.all([
    read('../novelight-r15-discovery.js'),
    read('../novelight-discovery-list.js'),
    read('../index.html')
  ]);
  assert.doesNotMatch(runtime, /mixRecommendedRows|shownR15|r15Allowed/);
  assert.doesNotMatch(list, /mixRecommendedRows|mixedCandidates/);
  assert.match(
    list,
    /const filteredCandidates = await filterHiddenRows\(candidates\)/
  );
  assert.match(
    list,
    /candidates.splice\(0, candidates.length, ...filteredCandidates\)/
  );
  assert.match(home, /p_surface:'home_discovery',p_limit:limit/);
  assert.match(list, /await recordTrusted\(visible\)/);
  assert.match(runtime, /R15作品を表示しない/);
  assert.match(runtime, /return localStorage.getItem\(KEY\) === '1'/);
});

test('the database migrates from separate rating quotas to one common ranking', async () => {
  const migration = await read(
    '../supabase/migrations/20261012103000_r15_parity_light_seed.sql'
  );
  assert.match(migration, /rating_ranked as materialized/);
  assert.match(migration, /r\.needs_initial_exposure desc/);
  assert.match(migration, /r\.normalized_author_exposure asc/);
  assert.match(migration, /r\.normalized_novel_exposure asc/);
  assert.match(migration, /from ranked r/);
  assert.match(migration, /execute v_definition/);
  assert.match(
    migration,
    /'rating_ranked as materialized'\) <> 0/
  );
});

test('R15 and general have identical LIGHT SEED eligibility safeguards', async () => {
  const migration = await read(
    '../supabase/migrations/20261012103000_r15_parity_light_seed.sql'
  );
  const rollback = await read(
    '../supabase/rollback/20261012103000_r15_parity_light_seed_rollback.sql'
  );
  assert.match(
    migration,
    /p_content_rating in \('general', 'sensitive_15'\)/
  );
  assert.match(migration, /coalesce\(p_ai_usage, ''\) <> 'ai_generated'/);
  assert.match(migration, /public\.novelight_discovery_zone\('human', 'adult_18_nonsexual'\)/);
  assert.match(migration, /public\.light_seed_status_auto_v1\(text\)/);
  assert.match(migration, /public\.plant_light_seed_auto_v1\(text\)/);
  assert.match(migration, /public\.light_seed_status_v2\(text\)/);
  assert.match(migration, /public\.plant_light_seed_v2\(text,text\)/);
  assert.match(migration, /public\.novelight_light_seed_feed\(integer,integer\)/);
  assert.doesNotMatch(migration, /truncate |delete from public\.light_seeds/i);
  assert.match(rollback, /p_content_rating = 'general'/);
  assert.match(rollback, /rating_ranked as materialized/);
});
