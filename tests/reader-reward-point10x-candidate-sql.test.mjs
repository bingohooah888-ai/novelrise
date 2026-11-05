import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {
  unwrapCandidateSql,
  composeCandidateRollbackSql
} from '../scripts/staging-candidate-sql.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '20261105120000';
const files = {
  migration: 'supabase/migrations/' + version + '_reader_reward_point10x.sql',
  precheck:
    'supabase/checks/' + version + '_reader_reward_point10x_precheck.sql',
  postcheck:
    'supabase/checks/' + version + '_reader_reward_point10x_postcheck.sql',
  rollback:
    'supabase/rollback/' + version + '_reader_reward_point10x_rollback.sql'
};
const sql = Object.fromEntries(
  Object.entries(files).map(([k, path]) => [
    k,
    readFileSync(resolve(root, path), 'utf8')
  ])
);
const compiled = () => composeCandidateRollbackSql(sql);
const readOnlyGuard = (k) => assert.match(sql[k], /RAISE EXCEPTION 'NL10_/u);

test('four exact version-pinned SQL artifacts are present', () => {
  assert.deepEqual(Object.keys(sql).sort(), [
    'migration',
    'postcheck',
    'precheck',
    'rollback'
  ]);
  for (const [k, v] of Object.entries(sql)) assert.ok(v.length > 500, k);
});
test('trusted main compiler accepts exactly precheck, migration, postcheck', () => {
  for (const k of ['precheck', 'migration', 'postcheck'])
    assert.ok(unwrapCandidateSql(sql[k], k).length > 300);
});
test('trusted compiler wraps the candidate in exactly one ROLLBACK', () => {
  const c = compiled();
  assert.match(c, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.equal((c.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((c.match(/^COMMIT;$/gm) || []).length, 0);
  assert.equal((c.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.ok(c.trimEnd().endsWith('ROLLBACK;'));
});
test('unsafe external operations and transaction escapes are absent', () => {
  for (const [k, v] of Object.entries(sql)) {
    assert.doesNotMatch(
      v,
      /\\connect|\\!|\\copy|dblink|http_post|pg_net|pg_cron|pg_notify|CREATE\s+EXTENSION|SECURITY\s+DEFINER/iu,
      k
    );
  }
});
test('migration has one BEGIN and one COMMIT but no independent rollback', () => {
  assert.equal((sql.migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((sql.migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((sql.migration.match(/^ROLLBACK;$/gm) || []).length, 0);
});
test('no pre or post SQL can escape outer transaction', () => {
  for (const k of ['precheck', 'postcheck'])
    assert.doesNotMatch(
      sql[k],
      /^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\s*;/imu
    );
});
test('precheck exclusively locks all four mutable Point tables', () => {
  assert.match(
    sql.precheck,
    /LOCK TABLE public\.scout_point_ledger, public\.scout_badge_definitions,[\s\S]*public\.user_scout_badges, public\.scout_point_operator_actions IN ACCESS EXCLUSIVE MODE/u
  );
  assert.ok(
    sql.precheck.indexOf('LOCK TABLE') <
      sql.precheck.indexOf('CREATE TEMP TABLE')
  );
});
test('precheck binds historical Staging rows/Point/users and badge definitions', () => {
  for (const n of [3581, 1605, 182, 835, 12870, 7162])
    assert.ok(sql.precheck.includes('<> ' + n), n);
});
test('precheck only recognizes the two known Point milestone definitions', () => {
  for (const s of [
    'reader_point_100',
    'reader_point_500',
    "metric_key='scout_point_earned_total'",
    'target_value=100',
    'target_value=500'
  ])
    assert.ok(sql.precheck.includes(s), s);
});
test('precheck checks all integer, bigint and database Point amount constraints', () => {
  for (const s of ['1000000', '100000', '2147483647', '922337203685477580'])
    assert.ok(sql.precheck.includes(s), s);
});
test('precheck rejects unit markers and different writer RPC definitions', () => {
  for (const s of [
    "metadata ? 'point_unit_version'",
    "to_regclass('public.scout_point_unit_cutover_marker')",
    '830b9784d2e7d5bdd71054188aa06e91',
    'e912c55468e49cdcf00be084f21d283b'
  ])
    assert.ok(sql.precheck.includes(s), s);
});
test('precheck detects unrelated triggers and definition drift', () => {
  for (const s of [
    'NL10_PRECHECK_UNREVIEWED_TRIGGER',
    'NL10_PRECHECK_TRIGGER_DEFINITION_DRIFT',
    'UPDATE OF status'
  ])
    assert.ok(sql.precheck.includes(s));
});
test('precheck stores full row snapshots only in transaction-scoped temp tables', () => {
  for (const x of ['ledger', 'badges', 'progress', 'operator'])
    assert.ok(
      sql.precheck.includes(
        'CREATE TEMP TABLE nl10_before_' + x + ' ON COMMIT DROP'
      ),
      x
    );
});
test('ledger UPDATE scales all statuses, including negative or frozen', () => {
  assert.match(
    sql.migration,
    /UPDATE public\.scout_point_ledger\s+SET point_value = \(point_value::bigint \* 10\)::integer/u
  );
  assert.doesNotMatch(sql.migration, /WHERE status\s*=/u);
});
test('badge reward and Point threshold are independently scaled', () => {
  assert.match(
    sql.migration,
    /SET point_reward = \(point_reward::bigint \* 10\)::integer/u
  );
  assert.match(sql.migration, /WHERE metric_key = 'scout_point_earned_total'/u);
});
test('Point badge progress and operator amount scaled but not unrelated progress', () => {
  assert.match(
    sql.migration,
    /WHERE badge_id IN \('reader_point_100', 'reader_point_500'\)/u
  );
  assert.match(sql.migration, /WHERE amount IS NOT NULL/u);
});
test('migration does not alter XP, event IDs, Rank or awarding RPC functions', () => {
  assert.doesNotMatch(
    sql.migration,
    /scout_xp_ledger|novelight_award_level_up_points|novelight_apply_scout_badge_evaluation|event_key|user_id|source_xp_id|reversal_of/iu
  );
});
test('postcheck performs exact full-row comparisons for all four tables', () => {
  assert.equal((sql.postcheck.match(/FULL JOIN/g) || []).length, 4);
  assert.equal(
    (sql.postcheck.match(/to_jsonb\(t\) IS DISTINCT FROM/g) || []).length,
    4
  );
});
test('postcheck compares all fixed cardinalities, 10x sums and threshold values', () => {
  for (const s of [
    '<> 3581',
    '<> 35810',
    '<> 1605',
    '<> 8350',
    '<> 71620',
    'target_value=1000',
    'target_value=5000'
  ])
    assert.ok(sql.postcheck.includes(s), s);
});
test('postcheck asserts old Level-up RPC was not changed or silently enabled', () => {
  assert.match(sql.postcheck, /NL10_POSTCHECK_WRITER_RPC_CHANGED/u);
  assert.match(sql.postcheck, /830b9784d2e7d5bdd71054188aa06e91/u);
});
test('rollback reviewer artifact is separate and never in trusted rollback compose', () => {
  assert.match(sql.rollback, /^ROLLBACK;/m);
  assert.doesNotMatch(compiled(), /NL10_ROLLBACK_LEDGER_NOT_RESTORED/u);
});
test('rollback checks ledger, badges, progress and writer unchanged', () => {
  for (const suffix of [
    'LEDGER_NOT_RESTORED',
    'BADGE_REWARD_NOT_RESTORED',
    'BADGE_PROGRESS_NOT_RESTORED',
    'WRITER_FUNCTION_DRIFT'
  ])
    assert.ok(sql.rollback.includes('NL10_ROLLBACK_' + suffix), suffix);
});
test('every guard file fails closed if a check fails', () => {
  for (const k of ['precheck', 'postcheck', 'rollback']) readOnlyGuard(k);
});
test('old 5pt level-up function is not modified during this rollback-only proof', () => {
  assert.ok(sql.precheck.includes('830b9784d2e7d5bdd71054188aa06e91'));
  assert.doesNotMatch(sql.migration, /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/iu);
});
test('normal migration replay cannot multiply data without the one-transaction precheck flag', () => {
  assert.match(
    sql.precheck,
    /SELECT set_config\('novelight\.point10x_rollback_proof',\s*'rollback-only',\s*true\)/u
  );
  assert.equal(
    (
      sql.migration.match(
        /current_setting\('novelight\.point10x_rollback_proof',\s*true\) = 'rollback-only'/g
      ) || []
    ).length,
    5
  );
  assert.doesNotMatch(sql.migration, /\bset_config\s*\(/u);
});
test('caller cannot make full persistent cutover via migration alone', () => {
  assert.doesNotMatch(
    sql.migration,
    /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+TABLE\s+public\.scout_point_unit_cutover_marker/iu
  );
  assert.match(sql.migration, /NO-OP/u);
});
test('main SQL validator rejects persistent malicious commands', () => {
  const bad = sql.migration.replace(
    'UPDATE public.scout_point_ledger',
    'ALTER SYSTEM SET work_mem'
  );
  assert.throws(() => unwrapCandidateSql(bad, 'migration'));
});
test('main SQL validator denies transaction escape and network calls', () => {
  assert.throws(() =>
    unwrapCandidateSql(
      sql.migration.replace('COMMIT;', 'ROLLBACK;\nCOMMIT;'),
      'migration'
    )
  );
  assert.throws(() =>
    unwrapCandidateSql(
      sql.precheck + "\nSELECT http_post('https://x','{}');",
      'precheck'
    )
  );
});
