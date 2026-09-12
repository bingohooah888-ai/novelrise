import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(
  new URL(
    '../supabase/migrations/20260913073000_chapter41_beta_rank_discovery_feed.sql',
    import.meta.url
  ),
  'utf8'
);

test('Chapter 41 home exposes discovery themes without exposing work Rank labels', () => {
  assert.match(index, /id="unseenShelfSection"[^>]*hidden/u);
  assert.match(index, /<h2>まだ知られていない物語<\/h2>/u);
  assert.match(index, /id="gatheringShelfSection"[^>]*hidden/u);
  assert.match(index, /<h2>いま光が集まりはじめた物語<\/h2>/u);
  assert.match(index, /novelight_beta_rank_discovery_feed/u);
  assert.match(index, /RANK_SHELF_MIN_CANDIDATES=4/u);
  assert.doesNotMatch(index, /Rank\s*[1-6]/u);
  assert.doesNotMatch(index, /\b(?:EMBER|SPARK|GLOW|BEACON|STAR|NOVA)\b/u);
});

test('public beta discovery RPC filters Rank internally and returns no Rank fields', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_beta_rank_discovery_feed\(/u
  );
  assert.match(migration, /rank_state\.current_rank between 1 and 2/u);
  assert.match(migration, /rank_state\.current_rank between 3 and 4/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_beta_rank_discovery_feed\(text, integer, text\)[\s\S]*?to anon, authenticated;/u
  );
  assert.doesNotMatch(
    migration,
    /grant\s+select\s+on\s+(?:table\s+)?public\.novel_rank_state/iu
  );

  const returns = migration.match(
    /returns table \(([\s\S]*?)\)\nlanguage sql/u
  );
  assert.ok(returns, 'RPC return table should be present');
  assert.doesNotMatch(returns[1], /\brank\b/iu);
  assert.doesNotMatch(returns[1], /\b(?:exp|level|badge|score)\b/iu);
});

test('rank discovery shelves fail closed when the candidate pool is too small', () => {
  assert.match(index, /const RANK_SHELF_MIN_CANDIDATES=4/u);
  assert.match(index, /rows\.length<RANK_SHELF_MIN_CANDIDATES/u);
  assert.match(index, /section\.hidden=true/u);
  assert.match(index, /section\.hidden=false/u);
});
