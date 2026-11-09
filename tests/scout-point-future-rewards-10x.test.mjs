import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n'
  );
const migration = read(
  '../supabase/migrations/20261109173000_scout_point_future_rewards_10x.sql'
);
const old = read(
  '../supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql'
);
const ui = read('../novelight-scout-record.js');
const startKey =
  'create or replace function public.novelight_award_level_up_points()';
function getLevelFunction(source) {
  const start = source.indexOf(startKey);
  const end = source.indexOf('\n$$;', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4);
}

test('only new reader badge rewards are multiplied, old balances and criteria untouched', () => {
  assert.match(
    migration,
    /UPDATE public\.scout_badge_definitions\s+SET point_reward = point_reward \* 10\s+WHERE badge_category = 'reader' AND point_reward > 0;/u
  );
  assert.equal((migration.match(/\bUPDATE\b/g) || []).length, 1);
  assert.equal((migration.match(/\bBEGIN;/g) || []).length, 0);
  assert.equal((migration.match(/\bCOMMIT;/g) || []).length, 0);
  for (const oldData of [
    'scout_point_ledger',
    'scout_xp_ledger',
    'scout_event_ledger',
    'scout_point_operator_actions',
    'user_scout_badges'
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(
        '(?:UPDATE|DELETE FROM|TRUNCATE)\\s+(?:public\\.)?' + oldData + '\\b',
        'iu'
      )
    );
  }
  assert.doesNotMatch(
    migration,
    /\b(?:ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE TRIGGER|DROP TRIGGER)\b/iu
  );
  assert.doesNotMatch(migration, /\b(?:target_value|progress_value)\s*=/iu);
});

test('level-up awards 50 Point instead of 5 with every other function expression unchanged', () => {
  const legacy = getLevelFunction(old);
  const updated = getLevelFunction(migration);
  assert.equal((legacy.match(/^      5,$/gm) || []).length, 1);
  assert.equal(updated, legacy.replace('\n      5,\n', '\n      50,\n'));
  assert.match(updated, /security definer/);
  assert.match(updated, /on conflict \(event_key\) do nothing/);
  assert.match(updated, /light_seed_discovery/);
});

test('scheduled reader badge reward tiers are 10x, zero-reward badges stay zero', () => {
  for (const [before, after] of [
    [0, 0],
    [1, 10],
    [5, 50],
    [10, 100],
    [25, 250]
  ]) {
    const value = before > 0 ? before * 10 : before;
    assert.equal(value, after);
  }
  assert.match(migration, /badge_category = 'reader'/u);
});

test('existing screen derives future badge rewards and actual earned history from database values', () => {
  assert.match(ui, /row\.point_reward\s*\|\|\s*0/u);
  assert.match(ui, /\+\$\{n\(row\.point_reward\)\} Scout Point/u);
  assert.match(ui, /const amount = Number\(row\.point_value \|\| 0\)/u);
  assert.match(ui, /setText\('statPoint',\s*n\(/u);
  assert.match(ui, /現在の設定値/u);
  assert.match(ui, /現在の/u);
  assert.doesNotMatch(ui, /point_value\s*\*\s*10/u);
});
