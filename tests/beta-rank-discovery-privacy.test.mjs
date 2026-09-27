import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql';
const guardPath =
  'supabase/migrations/20260928061100_beta_rank_discovery_rpc_guard.sql';
const pagePath = 'scout-record.html';

const [migration, guard, page] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(guardPath, 'utf8'),
  readFile(pagePath, 'utf8')
]);

test('beta keeps LIGHT SEED sending badges while disabling work-Rank badges', () => {
  assert.match(migration, /reader_discovery_%/);
  assert.match(migration, /reader_nova_%/);
  assert.match(migration, /reader_low_rank_%/);
  assert.match(migration, /author_discovered_%/);
  assert.match(migration, /enabled = false/);
  assert.match(migration, /reader_seed_001/);
  assert.match(migration, /author_seed_received_001/);
});

test('beta discovery processing retains internal state but awards no discovery event or XP', () => {
  const betaProcessor = migration.match(
    /create or replace function public\.novelight_process_seed_discovery\(p_rank_event_id uuid\)([\s\S]*?)revoke all on function public\.novelight_process_seed_discovery\(uuid\)/
  )?.[1];
  assert.ok(betaProcessor, 'beta discovery processor must exist');
  assert.match(betaProcessor, /update public\.seed_discovery_state/);
  assert.doesNotMatch(betaProcessor, /insert into public\.scout_event_ledger/);
  assert.doesNotMatch(betaProcessor, /insert into public\.scout_xp_ledger/);
  assert.match(migration, /if new\.xp_kind = 'light_seed_discovery' then\s+return null;/);
});

test('beta public RPCs hide rank discovery and rank-derived points', () => {
  assert.match(migration, /'rank_discovery_public', false/);
  assert.match(migration, /'discovery_success_count', 0/);
  assert.match(migration, /where false/);
  assert.match(migration, /novelight_beta_rank_point_is_hidden/);
  assert.doesNotMatch(
    migration.match(
      /create or replace function public\.novelight_scout_recent_activity\(p_limit integer default 20\)([\s\S]*?)revoke all on function public\.novelight_scout_recent_activity\(integer\)/
    )?.[1] || '',
    /'light_seed_discovery'/
  );
  assert.match(guard, /revoke all on function public\.novelight_scout_discoveries_rank_internal_20260928/);
  assert.match(guard, /and d\.enabled/);
});

test('SCOUT RECORD beta UI shows SEED activity without work-Rank discovery surfaces', () => {
  assert.match(page, /あなたのLIGHT SEED活動とスカウトとしての成長/);
  assert.match(page, /LIGHT SEED送信履歴/);
  assert.match(page, /作品Rankに関する発掘結果はβ版では表示しません/);
  assert.doesNotMatch(page, /id="statDiscoveries"/);
  assert.doesNotMatch(page, /id="discoveriesTitle"/);
  assert.doesNotMatch(page, /id="discoveriesList"/);
  assert.doesNotMatch(page, /送信後に\+2以上へ成長した作品/);
});
