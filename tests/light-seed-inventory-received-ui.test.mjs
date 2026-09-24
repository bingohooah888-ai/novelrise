import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scout = await readFile('scout-record.html', 'utf8');
const scoutJs = await readFile('novelight-scout-record.js', 'utf8');
const scoutCss = await readFile('novelight-scout-record.css', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const migrationPath =
  'supabase/migrations/20260924214000_light_seed_inventory_received_summary.sql';
const postcheckPath =
  'supabase/checks/20260924214000_light_seed_inventory_received_summary_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260924214000_light_seed_inventory_received_summary_rollback.sql';
const migration = await readFile(migrationPath, 'utf8');
const postcheck = await readFile(postcheckPath, 'utf8');
const rollback = await readFile(rollbackPath, 'utf8');

function contains(source, token) {
  assert.ok(source.includes(token), `Missing contract token: ${token}`);
}

test('LIGHT SEED summary RPC contracts', () => {
  contains(migration, 'novelight_light_seed_inventory()');
  contains(migration, 'novelight_author_received_light_seed_summary');
  contains(migration, 'v_uid uuid := (select auth.uid())');
  contains(migration, 'Only the work owner');
  contains(migration, "s.seed_type = 'GOLD'");
  contains(migration, "s.seed_type = 'SILVER'");
  contains(migration, "s.seed_type = 'BRONZE'");
  contains(migration, "'gold_remaining'");
  contains(migration, "'silver_remaining'");
  contains(migration, "'bronze_remaining'");
  contains(postcheck, 'must remain RPC-only and private');
  contains(rollback, 'novelight_light_seed_inventory');
  contains(rollback, 'novelight_author_received_light_seed_summary');
});

test('SCOUT RECORD shows held typed LIGHT SEED inventory', () => {
  contains(scout, 'id="seedInventoryTitle"');
  contains(scout, 'LIGHT SEED 所持数');
  contains(scout, 'id="seedInventoryTotal"');
  contains(scout, 'id="seedGoldRemaining"');
  contains(scout, 'id="seedSilverRemaining"');
  contains(scout, 'id="seedBronzeRemaining"');
  contains(scout, 'data-light-seed-icon-slot="GOLD"');
  contains(scout, 'data-light-seed-icon-slot="SILVER"');
  contains(scout, 'data-light-seed-icon-slot="BRONZE"');
  contains(scoutCss, '.seed-inventory-icon-slot{');
  contains(scoutCss, 'width:78px;height:78px');
  contains(scoutJs, "rpc('novelight_light_seed_inventory')");
  contains(scoutJs, 'function renderSeedInventory(inventory)');
  contains(scoutJs, 'seedInventoryLegacyNote');
});

test('work owners see received typed LIGHT SEED totals', () => {
  contains(novel, 'id="receivedSeedArea"');
  contains(novel, '作品に届いたLIGHT SEED');
  contains(novel, 'id="receivedSeedTotal"');
  contains(novel, 'id="receivedSeedGold"');
  contains(novel, 'id="receivedSeedSilver"');
  contains(novel, 'id="receivedSeedBronze"');
  contains(novel, 'data-light-seed-icon-slot="GOLD"');
  contains(novel, 'data-light-seed-icon-slot="SILVER"');
  contains(novel, 'data-light-seed-icon-slot="BRONZE"');
  contains(novel, 'String(novel.user_id)!==String(session.user.id)');
  contains(novel, 'novelight_author_received_light_seed_summary');
  contains(novel, '旧仕様LIGHT SEED');
});
