import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const basename = 'gatea_staging_stop_positive_budgets_PROPOSAL.sql';
const sqlFile = new URL('../reports/sql/' + basename, import.meta.url);
const sql = readFileSync(sqlFile, 'utf8');
const active = sql.split('-- ROLLBACK (commented deliberately')[0];

test('Gate A positive-budget STOP is an unapplied Staging-only function proposal', () => {
  for (const expected of [
    /PROPOSAL ONLY\. Never auto-apply/u,
    /wmlzjgvxgoyrovdhbqbg/u,
    /CREATE OR REPLACE FUNCTION gatea_stop_private\.stop_once\(\)/u,
    /SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/u,
    /session_user <> 'novelight_gatea_stop'/u,
    /GATEA_STOP_MIGRATION_NOT_SAFELY_OFF_NO_GO/u,
    /GATEA_STOP_MIGRATION_FUNCTION_DRIFT_NO_GO/u,
    /GATEA_STOP_EXPECTED_ONE_ARMED_ROW_NO_GO/u,
    /GATEA_STOP_VERIFY_NO_GO/u
  ]) {
    assert.match(active, expected);
  }

  const update = active.match(
    /UPDATE public\.novelight_ai_runtime_settings([\s\S]*?)GET DIAGNOSTICS/u
  )?.[1];
  assert.ok(update);
  assert.match(update, /WHERE singleton = 1\s+AND enabled IS TRUE;/u);
  for (const name of [
    'user_day_cap_micros',
    'user_month_cap_micros',
    'global_day_cap_micros',
    'global_month_cap_micros'
  ]) {
    assert.match(update, new RegExp(name + ' = 0', 'u'));
    assert.doesNotMatch(update, new RegExp('AND ' + name + ' = 0', 'u'));
  }

  const mutations = active.match(
    /UPDATE public\.novelight_ai_runtime_settings/gu
  );
  assert.equal(mutations?.length, 1);
  assert.doesNotMatch(
    active,
    /^\s*(GRANT|REVOKE|DROP|CREATE ROLE|ALTER ROLE)\b/imu
  );
});

test('Gate A rollback is recorded but cannot execute with the proposal', () => {
  assert.match(sql, /-- ROLLBACK \(commented deliberately/u);
  assert.match(sql, /\/\*\s*BEGIN;\s*CREATE OR REPLACE FUNCTION/u);
  assert.match(
    sql,
    /AND user_day_cap_micros = 0\s+AND user_month_cap_micros = 0\s+AND global_day_cap_micros = 0\s+AND global_month_cap_micros = 0/u
  );
  assert.match(sql, /COMMIT;\s*\*\//u);
});
