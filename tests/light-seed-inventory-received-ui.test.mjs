import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scout = await readFile('scout-record.html', 'utf8');
const scoutJs = await readFile('novelight-scout-record.js', 'utf8');
const scoutCss = await readFile('novelight-scout-record.css', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260924214000_light_seed_inventory_received_summary.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260924214000_light_seed_inventory_received_summary_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260924214000_light_seed_inventory_received_summary_rollback.sql',
  'utf8'
);

test('private LIGHT SEED summary RPCs expose inventory and owner-only received counts', () => {
  assert.match(migration, /novelight_light_seed_inventory\(\)/u);
  assert.match(
    migration,
    /novelight_author_received_light_seed_summary\(\s*p_novel_id text/u
  );
  assert.match(migration, /v_uid uuid := \(select auth\.uid\(\)\)/u);
  assert.match(migration, /Only the work owner can view received LIGHT SEED breakdown/u);
  assert.match(migration, /count\(\*\) filter \(where s\.seed_type = 'GOLD'\)/u);
  assert.match(migration, /count\(\*\) filter \(where s\.seed_type = 'SILVER'\)/u);
  assert.match(migration, /count\(\*\) filter \(where s\.seed_type = 'BRONZE'\)/u);
  assert.match(migration, /gold_remaining/u);
  assert.match(migration, /silver_remaining/u);
  assert.match(migration, /bronze_remaining/u);
  assert.match(postcheck, /must remain RPC-only and private/u);
  assert.match(rollback, /drop function if exists public\.novelight_light_seed_inventory/u);
  assert.match(
    rollback,
    /drop function if exists public\.novelight_author_received_light_seed_summary/u
  );
});

test('SCOUT RECORD shows held GOLD SILVER BRONZE inventory with artwork slots', () => {
  assert.match(scout, /id="seedInventoryTitle">LIGHT SEED 所持数/u);
  assert.match(scout, /id="seedInventoryTotal"/u);
  assert.match(scout, /id="seedGoldRemaining"/u);
  assert.match(scout, /id="seedSilverRemaining"/u);
  assert.match(scout, /id="seedBronzeRemaining"/u);
  for (const type of ['GOLD', 'SILVER', 'BRONZE']) {
    assert.match(
      scout,
      new RegExp(`data-light-seed-icon-slot="${type}"`, 'u')
    );
  }
  assert.match(scoutCss, /\.seed-inventory-icon-slot\{/u);
  assert.match(scoutCss, /width:78px;height:78px/u);
  assert.match(scoutJs, /client\.rpc\('novelight_light_seed_inventory'\)/u);
  assert.match(scoutJs, /function renderSeedInventory\(inventory\)/u);
  assert.match(scoutJs, /seedInventoryLegacyNote/u);
});

test('work owners see received LIGHT SEED totals and typed breakdown only on their own work', () => {
  assert.match(novel, /id="receivedSeedArea"/u);
  assert.match(novel, /作品に届いたLIGHT SEED/u);
  assert.match(novel, /id="receivedSeedTotal"/u);
  assert.match(novel, /id="receivedSeedGold"/u);
  assert.match(novel, /id="receivedSeedSilver"/u);
  assert.match(novel, /id="receivedSeedBronze"/u);
  assert.match(novel, /class="received-seed-icon-slot" data-light-seed-icon-slot="GOLD"/u);
  assert.match(novel, /class="received-seed-icon-slot" data-light-seed-icon-slot="SILVER"/u);
  assert.match(novel, /class="received-seed-icon-slot" data-light-seed-icon-slot="BRONZE"/u);
  assert.match(
    novel,
    /String\(novel\.user_id\)!==String\(session\.user\.id\)/
  );
  assert.match(
    novel,
    /client\.rpc\('novelight_author_received_light_seed_summary',\{p_novel_id:String\(novel\.id\)\}\)/
  );
  assert.match(novel, /旧仕様LIGHT SEED/u);
});
