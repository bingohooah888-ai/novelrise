import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('recommendation selection does not quota or reshuffle R15 vs general', async () => {
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

test('database recommendation restores one common category-neutral ranking', async () => {
  const migration = await read(
    '../supabase/migrations/20261012103000_r15_parity_light_seed.sql'
  );
  assert.match(migration, /r\.needs_initial_exposure desc/);
  assert.match(migration, /r\.normalized_author_exposure asc/);
  assert.match(migration, /r\.normalized_novel_exposure asc/);
  assert.match(migration, /from ranked r/);
  assert.doesNotMatch(migration, /rating_rank \* 3 - 2/);
  assert.match(migration, /rating_ranked as materialized/);
});
