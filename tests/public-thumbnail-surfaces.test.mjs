import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [home, search, ranking, stagingSmoke, migration, rollback] =
  await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../search.html', import.meta.url), 'utf8'),
    readFile(new URL('../ranking.html', import.meta.url), 'utf8'),
    readFile(
      new URL('./e2e/staging/thumbnail-flow.spec.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../supabase/migrations/20260913141000_public_thumbnail_lookup.sql',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../supabase/rollback/20260913141000_public_thumbnail_lookup_rollback.sql',
        import.meta.url
      ),
      'utf8'
    )
  ]);

test('Home new arrivals hydrates and renders official thumbnails', () => {
  assert.match(home, /select\('id,thumbnail_url'\)/u);
  assert.match(home, /loadNewArrivals\(\)/u);
  assert.match(home, /class=\\?"novel-cover-image\\?"/u);
});

test('Search hydrates official thumbnails through the bounded RPC', () => {
  assert.match(search, /select\('id,ai_usage,content_rating'\)/u);
  assert.match(search, /rpc\('novelight_public_thumbnail_urls'/u);
  assert.doesNotMatch(
    search,
    /select\('id,ai_usage,content_rating,thumbnail_url'\)/u
  );
  assert.match(search, /function coverMarkup\(n\)/u);
  assert.match(search, /class=\\?"novel-cover-image\\?"/u);
});

test('Ranking uses aggregate feeds and the bounded thumbnail RPC', () => {
  assert.match(ranking, /rpc\('novelight_ranking_feed'/u);
  assert.match(ranking, /rpc\('novelight_public_thumbnail_urls'/u);
  assert.doesNotMatch(ranking, /from\('novels'\)\.select/u);
  assert.match(ranking, /class=\\?"novel-cover-image\\?"/u);
});

test('Public thumbnail lookup is published-only and bounded', () => {
  assert.match(migration, /security definer/iu);
  assert.match(migration, /cardinality\(p_novel_ids\) > 100/u);
  assert.match(migration, /n\.status = 'published'/u);
  assert.match(migration, /n\.thumbnail_url like 'https:\/\/%'/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_public_thumbnail_urls\(text\[\]\) to anon, authenticated/iu
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_public_thumbnail_urls\(text\[\]\)/iu
  );
});

test('Staging thumbnail smoke asserts the shared public cover contract', () => {
  assert.match(stagingSmoke, /locator\('img\.novel-cover-image'\)/u);
  assert.doesNotMatch(stagingSmoke, /novelight-official-thumbnail/u);
});
