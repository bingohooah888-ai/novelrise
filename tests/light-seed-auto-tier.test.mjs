import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationPath = new URL(
  '../supabase/migrations/20260927130000_beta_light_seed_auto_tier.sql',
  import.meta.url
);
const novelRuntimePath = new URL('../novelight-novel-poll.js', import.meta.url);
const novelPagePath = new URL('../novel.html', import.meta.url);
const seoNovelPagePath = new URL(
  '../api/seo/templates/novel.html',
  import.meta.url
);

const [migration, novelRuntime, novelPage, seoNovelPage] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(novelRuntimePath, 'utf8'),
  readFile(novelPagePath, 'utf8'),
  readFile(seoNovelPagePath, 'utf8')
]);

test('beta LIGHT SEED uses a server-authoritative automatic tier contract', () => {
  assert.match(migration, /light_seed_status_auto_v1\(p_novel_id text\)/u);
  assert.match(migration, /plant_light_seed_auto_v1\(p_novel_id text\)/u);
  assert.match(migration, /when v_rank between 1 and 2 then 'GOLD'/u);
  assert.match(migration, /when v_rank between 3 and 4 then 'SILVER'/u);
  assert.match(
    migration,
    /revoke all on function public\.plant_light_seed_v2\(text, text\) from public, anon, authenticated;/u
  );
  assert.match(
    migration,
    /revoke all on function public\.light_seed_status_v2\(text\) from public, anon, authenticated;/u
  );
});

test('automatic tier keeps the final beta valid-read and favorite fairness contract', () => {
  const foregroundMatches = migration.match(/and r\.foreground_signal/gu) || [];
  const corroboratingMatches =
    migration.match(/and \(r\.progress_signal or r\.interaction_signal\)/gu) ||
    [];
  assert.ok(
    foregroundMatches.length >= 2,
    'status and send must both require foreground evidence'
  );
  assert.ok(
    corroboratingMatches.length >= 2,
    'status and send must both require progress or interaction'
  );
  assert.match(migration, /and f\.user_id <> v_author_id;/u);
});

test('public beta sender is one generic action and explains automatic switching', () => {
  assert.match(novelRuntime, /id="sendLightSeedButton"/u);
  assert.match(
    novelRuntime,
    /作品は内部的に区分されており、その区分に応じて使用されるLIGHT SEEDが自動で切り替わります。これは不具合ではなく仕様です。/u
  );
  assert.match(novelRuntime, /light_seed_status_auto_v1/u);
  assert.match(novelRuntime, /plant_light_seed_auto_v1/u);
  assert.doesNotMatch(novelRuntime, /p_seed_type/u);
});

test('the browser runtime does not contain the private Rank-to-tier thresholds', () => {
  assert.doesNotMatch(novelRuntime, /v_rank between/u);
  assert.doesNotMatch(novelRuntime, /work_rank_code/u);
  assert.doesNotMatch(novelRuntime, /work_rank['"]/u);
});

test('novel pages do not invoke the revoked manual LIGHT SEED status setup', () => {
  for (const markup of [novelPage, seoNovelPage]) {
    assert.doesNotMatch(markup, /void setupSeed\(\);/u);
    assert.match(markup, /void setupReceivedSeedSummary\(\);/u);
  }
});

test('public LIGHT SEED total uses lightweight artwork and does not expose the private tier', () => {
  assert.match(novelRuntime, /id="publicLightSeedCount"/u);
  assert.match(novelRuntime, /novelight-feature-light-seed\.webp/u);
  assert.match(novelRuntime, /value\?\.total_seed_count/u);
  assert.match(novelRuntime, /この作品が受け取ったLIGHT SEED/u);
  assert.match(novelRuntime, /publicCount\.textContent = '取得できません'/u);
  assert.doesNotMatch(novelRuntime, /light_seed_status_v2/u);
});

test('work detail restores the reader-only three-tier LIGHT SEED balance card', () => {
  assert.match(novelRuntime, /light-seed-content-grid/u);
  assert.match(novelRuntime, /novelReaderSeedTotal/u);
  assert.match(novelRuntime, /novelReaderSeedGold/u);
  assert.match(novelRuntime, /novelReaderSeedSilver/u);
  assert.match(novelRuntime, /novelReaderSeedBronze/u);
  assert.match(novelRuntime, /api\.rpc\('novelight_light_seed_inventory'\)/u);
  assert.match(novelRuntime, /if \(!auth\.data\?\.session\?\.user\?\.id\)/u);
  assert.match(novelRuntime, /readerInventory\.hidden = true/u);
  assert.match(novelRuntime, /void refreshReaderInventory\(\)/u);
  assert.match(novelRuntime, /publicLightSeedCount/u);
});
