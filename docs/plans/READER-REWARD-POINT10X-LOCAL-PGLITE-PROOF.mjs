// LOCAL PG SQL fixture, 2026-11-05. Synthetic rows only, no Supabase access.
// PostgreSQL 18 WASM PGlite 0.5.15; distinct from actual Supabase PostgreSQL 17.
import assert from 'node:assert/strict';
import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';

const create = [
  "CREATE TABLE scout_point_ledger(id uuid PRIMARY KEY,user_id uuid NOT NULL,event_key text NOT NULL UNIQUE,point_kind text NOT NULL,point_value integer NOT NULL CHECK (point_value BETWEEN -1000000 AND 1000000),status text NOT NULL CHECK (status IN ('confirmed','pending','frozen','cancelled')),reversal_of uuid,metadata jsonb NOT NULL DEFAULT '{}')",
  'CREATE TABLE scout_badge_definitions(badge_id text PRIMARY KEY,badge_category text NOT NULL,metric_key text,target_value bigint NOT NULL CHECK (target_value>0),point_reward integer NOT NULL CHECK (point_reward>=0))',
  "CREATE TABLE user_scout_badges(user_id uuid NOT NULL,badge_id text NOT NULL,progress_value bigint NOT NULL,progress_percent numeric(5,2) NOT NULL,status text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',PRIMARY KEY(user_id,badge_id))",
  'CREATE TABLE scout_point_operator_actions(id uuid PRIMARY KEY,amount integer CHECK (amount BETWEEN -100000 AND 100000))',
  'CREATE TABLE scout_xp_ledger(id uuid PRIMARY KEY,xp_value integer NOT NULL)',
  'CREATE TABLE private_point_cutover_marker(cutover text PRIMARY KEY,source_unit text NOT NULL,target_unit text NOT NULL)',
  "CREATE OR REPLACE FUNCTION sandbox_level_up_point_amount() RETURNS integer LANGUAGE sql AS 'SELECT 5'",
  "INSERT INTO scout_point_ledger(id,user_id,event_key,point_kind,point_value,status,reversal_of) VALUES ('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','badge:fixture:1','badge',25,'confirmed',NULL),('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','level_up:fixture:2','level_up',5,'confirmed',NULL),('33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','reversal:fixture:3','reversal',-5,'confirmed','22222222-2222-4222-8222-222222222222'),('44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','pending:fixture:4','badge',3,'pending',NULL)",
  "INSERT INTO scout_badge_definitions(badge_id,badge_category,metric_key,target_value,point_reward) VALUES ('reader_point_100','reader','scout_point_earned_total',100,0),('reader_point_500','reader','scout_point_earned_total',500,0),('reader_read_5','reader','completed_reads',5,5),('author_works_10','author','author_work_count',10,0)",
  "INSERT INTO user_scout_badges(user_id,badge_id,progress_value,progress_percent,status) VALUES ('55555555-5555-4555-8555-555555555555','reader_point_100',25,25,'active'),('55555555-5555-4555-8555-555555555555','reader_point_500',25,5,'active'),('55555555-5555-4555-8555-555555555555','reader_read_5',3,60,'active')",
  "INSERT INTO scout_point_operator_actions(id,amount) VALUES ('66666666-6666-4666-8666-666666666666',12)",
  "INSERT INTO scout_xp_ledger(id,xp_value) VALUES ('11111111-1111-4111-8111-111111111111',120)"
];
const allTables = [
  'scout_point_ledger',
  'scout_badge_definitions',
  'user_scout_badges',
  'scout_point_operator_actions',
  'scout_xp_ledger'
];
let passed = 0;
function verify(ok, label) {
  assert.ok(ok, label);
  passed++;
}
async function state(db) {
  const out = [];
  for (const name of allTables) {
    const rows = (await db.query('SELECT * FROM ' + name + ' ORDER BY 1')).rows;
    out.push([name, rows]);
  }
  const n = (await db.query('SELECT sandbox_level_up_point_amount() AS x'))
    .rows[0].x;
  return JSON.stringify([out, n], (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}
async function checked(db, query) {
  return (await db.query(query)).rows[0];
}
async function runCutover(db, inject = false) {
  await db.exec('BEGIN');
  try {
    await db.exec(
      'LOCK TABLE scout_point_ledger,scout_badge_definitions,user_scout_badges,scout_point_operator_actions IN ACCESS EXCLUSIVE MODE'
    );
    if (
      (
        await checked(
          db,
          'SELECT count(*)::int AS n FROM private_point_cutover_marker'
        )
      ).n !== 0
    )
      throw Error('ALREADY_CONVERTED');
    if (
      (
        await checked(
          db,
          'SELECT count(*)::int AS n FROM scout_point_ledger WHERE point_value::bigint*10 NOT BETWEEN -1000000 AND 1000000'
        )
      ).n !== 0
    )
      throw Error('CONSTRAINT_OVERFLOW');
    await db.exec(
      "INSERT INTO private_point_cutover_marker VALUES('beta_10x_20261105','1pt_per_yen','10pt_per_yen')"
    );
    await db.exec('UPDATE scout_point_ledger SET point_value=point_value*10');
    if (inject) throw Error('INJECTED_FAULT');
    await db.exec(
      'UPDATE scout_badge_definitions SET point_reward=point_reward*10'
    );
    await db.exec(
      "UPDATE scout_badge_definitions SET target_value=target_value*10 WHERE metric_key='scout_point_earned_total'"
    );
    await db.exec(
      "UPDATE user_scout_badges SET progress_value=progress_value*10 WHERE badge_id IN ('reader_point_100','reader_point_500')"
    );
    await db.exec(
      'UPDATE scout_point_operator_actions SET amount=amount*10 WHERE amount IS NOT NULL'
    );
    await db.exec(
      "CREATE OR REPLACE FUNCTION sandbox_level_up_point_amount() RETURNS integer LANGUAGE sql AS 'SELECT 50'"
    );
    if (
      (
        await checked(
          db,
          'SELECT sum(point_value)::int AS n FROM scout_point_ledger'
        )
      ).n !== 280
    )
      throw Error('BAD_LEDGER_SUM');
    if (
      (await checked(db, 'SELECT sandbox_level_up_point_amount() AS n')).n !==
      50
    )
      throw Error('BAD_MOCK_GRANT');
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function rollbackToBackup(db) {
  await db.exec('BEGIN');
  try {
    await db.exec(
      'LOCK TABLE scout_point_ledger,scout_badge_definitions,user_scout_badges,scout_point_operator_actions IN ACCESS EXCLUSIVE MODE'
    );
    for (const [name, keys, fields] of [
      ['scout_point_ledger', ['id'], ['point_value']],
      [
        'scout_badge_definitions',
        ['badge_id'],
        ['point_reward', 'target_value']
      ],
      ['user_scout_badges', ['user_id', 'badge_id'], ['progress_value']],
      ['scout_point_operator_actions', ['id'], ['amount']]
    ]) {
      const condition = keys.map((k) => 'dst.' + k + '=src.' + k).join(' AND ');
      const set = fields.map((k) => k + '=src.' + k).join(',');
      await db.exec(
        'UPDATE ' +
          name +
          ' AS dst SET ' +
          set +
          ' FROM backup_' +
          name +
          ' AS src WHERE ' +
          condition
      );
    }
    await db.exec(
      "CREATE OR REPLACE FUNCTION sandbox_level_up_point_amount() RETURNS integer LANGUAGE sql AS 'SELECT 5'"
    );
    await db.exec(
      "DELETE FROM private_point_cutover_marker WHERE cutover='beta_10x_20261105'"
    );
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
const db = new PGlite();
try {
  for (const statement of create) await db.exec(statement);
  for (const t of allTables)
    await db.exec('CREATE TABLE backup_' + t + ' AS SELECT * FROM ' + t);
  const original = await state(db);
  verify(
    (
      await checked(
        db,
        'SELECT sum(point_value)::int AS n FROM scout_point_ledger'
      )
    ).n === 28,
    'baseline sum'
  );
  try {
    await runCutover(db, true);
    throw Error('INJECTION_DID_NOT_FAIL');
  } catch (e) {
    verify(e.message === 'INJECTED_FAULT', 'intentional fault happened');
  }
  verify(
    (await state(db)) === original,
    'abort rolls back all values, statuses, function'
  );
  verify(
    (
      await checked(
        db,
        'SELECT count(*)::int AS n FROM private_point_cutover_marker'
      )
    ).n === 0,
    'marker rolls back atomically'
  );
  await runCutover(db);
  verify(
    (
      await checked(
        db,
        'SELECT sum(point_value)::int AS n FROM scout_point_ledger'
      )
    ).n === 280,
    'all ledger points x10'
  );
  verify(
    (await checked(db, 'SELECT count(*)::int AS n FROM scout_point_ledger'))
      .n === 4,
    'ledger row count unchanged'
  );
  verify(
    (
      await checked(
        db,
        'SELECT count(DISTINCT event_key)::int AS n FROM scout_point_ledger'
      )
    ).n === 4,
    'dedupe keys preserved'
  );
  verify(
    (
      await checked(
        db,
        "SELECT point_value AS n FROM scout_point_ledger WHERE point_kind='reversal'"
      )
    ).n === -50,
    'negative reversal x10'
  );
  verify(
    (
      await checked(
        db,
        "SELECT point_value AS n FROM scout_point_ledger WHERE status='pending'"
      )
    ).n === 30,
    'pending value x10'
  );
  verify(
    (
      await checked(
        db,
        "SELECT target_value::int AS n FROM scout_badge_definitions WHERE badge_id='reader_point_500'"
      )
    ).n === 5000,
    'point badge threshold x10'
  );
  verify(
    (
      await checked(
        db,
        "SELECT target_value::int AS n FROM scout_badge_definitions WHERE badge_id='reader_read_5'"
      )
    ).n === 5,
    'unrelated badge threshold unchanged'
  );
  verify(
    (
      await checked(
        db,
        "SELECT point_reward AS n FROM scout_badge_definitions WHERE badge_id='reader_read_5'"
      )
    ).n === 50,
    'badge award x10'
  );
  verify(
    (
      await checked(
        db,
        "SELECT progress_value::int AS n FROM user_scout_badges WHERE badge_id='reader_point_100'"
      )
    ).n === 250,
    'point progress x10'
  );
  verify(
    (
      await checked(
        db,
        "SELECT progress_value::int AS n FROM user_scout_badges WHERE badge_id='reader_read_5'"
      )
    ).n === 3,
    'unrelated progress unchanged'
  );
  verify(
    (
      await checked(
        db,
        "SELECT progress_percent::numeric AS n FROM user_scout_badges WHERE badge_id='reader_point_100'"
      )
    ).n == 25,
    'progress percentage conserved'
  );
  verify(
    (await checked(db, 'SELECT amount AS n FROM scout_point_operator_actions'))
      .n === 120,
    'operator adjustment x10'
  );
  verify(
    (await checked(db, 'SELECT xp_value AS n FROM scout_xp_ledger')).n === 120,
    'XP untouched'
  );
  verify(
    (await checked(db, 'SELECT sandbox_level_up_point_amount() AS n')).n === 50,
    'new mocked level grant 50'
  );
  const once = await state(db);
  try {
    await runCutover(db);
    throw Error('DOUBLE_CONVERSION_NOT_REJECTED');
  } catch (e) {
    verify(e.message === 'ALREADY_CONVERTED', 'second conversion prevented');
  }
  verify((await state(db)) === once, 'second attempt does not mutate values');
  await rollbackToBackup(db);
  verify(
    (await state(db)) === original,
    'backup restores all five tables and function'
  );
  verify(
    (
      await checked(
        db,
        'SELECT count(*)::int AS n FROM private_point_cutover_marker'
      )
    ).n === 0,
    'rollback clears marker during maintenance only'
  );
  await runCutover(db);
  verify(
    (
      await checked(
        db,
        'SELECT sum(point_value)::int AS n FROM scout_point_ledger'
      )
    ).n === 280,
    'after rollback one clean retry succeeds'
  );
  console.log('LOCAL_PGLITE_SYNTHETIC_POSTGRES_PROOF_PASS=' + passed);
  console.log(
    'ENGINE=PGlite-0.5.15-PostgreSQL-18-WASM, Supabase production/staging untouched'
  );
} finally {
  await db.close();
}
