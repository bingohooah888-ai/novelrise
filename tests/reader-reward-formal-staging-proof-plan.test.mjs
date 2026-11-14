import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { FORMAL_MAINTENANCE_SAFETY_APPROVED } from '../api/_lib/reader-reward/formal-maintenance-release-gate.js';

const matrix = JSON.parse(
  readFileSync(
    new URL(
      '../docs/plans/SCOUT_30DAY_STAGING_PROOF_MATRIX_20261114.json',
      import.meta.url
    ),
    'utf8'
  )
);
const plan = readFileSync(
  new URL(
    '../docs/plans/SCOUT_30DAY_STAGING_PROOF_PLAN_20261114.md',
    import.meta.url
  ),
  'utf8'
);
const staging = (id) =>
  matrix.stagingScenarios.find((scenario) => scenario.id === id);
const clone = (id) =>
  matrix.cloneScenarios.find((scenario) => scenario.id === id);

test('plan is design-only and cannot authorize execution', () => {
  assert.equal(matrix.mode, 'design_only');
  assert.equal(matrix.status, 'NOT_EXECUTED');
  assert.equal(matrix.executionAuthorized, false);
  assert.equal(matrix.restrictions.additionalApproval, true);
  assert.equal(FORMAL_MAINTENANCE_SAFETY_APPROVED, false);
});

test('Staging commit, data mutations and real review RPC are prohibited', () => {
  for (const key of [
    'stagingCommit',
    'realReviewRpc',
    'durableStagingDml',
    'production',
    'realUsers',
    'secrets',
    'sqlApply',
    'newWorkflow'
  ]) {
    assert.equal(matrix.restrictions[key], false, key);
  }
});

test('prechecks include SHA, migration health, identity and baseline', () => {
  for (const expected of [
    'P01_PR_AND_MAIN_SHA',
    'P02_STAGING_BRANCH_MIGRATION_HEALTH',
    'P03_SYNTHETIC_IDENTITY_UNIQUE',
    'P04_BASELINE_FULL_SNAPSHOT'
  ]) {
    assert.ok(matrix.precheck.includes(expected), expected);
  }
});

test('prechecks demand independently sticky sessions and rollback proof', () => {
  for (const expected of [
    'P06_THREE_STICKY_DISTINCT_SESSIONS',
    'P07_SAME_SESSION_ROLLBACK_GUARANTEE',
    'P08_NO_EXTERNAL_SIDE_EFFECTS'
  ]) {
    assert.ok(matrix.precheck.includes(expected), expected);
  }
});

test('A/B/C transaction advisory lock probe uses no durable DML', () => {
  const scenario = staging('S01');
  assert.deepEqual(scenario.sessions, ['A', 'B', 'C']);
  assert.equal(scenario.durableWrites, false);
  assert.equal(scenario.commit, false);
  assert.equal(scenario.provesXpWriterIntegration, false);
});

test('all Staging transactions terminate with ROLLBACK', () => {
  assert.deepEqual(staging('S01').transactionResults, [
    'ROLLBACK',
    'ROLLBACK',
    'ROLLBACK'
  ]);
});

test('try-lock proves contention, release, and separate connections', () => {
  assert.deepEqual(staging('S01').steps, [
    'A_LOCK_OBTAINED',
    'B_SAME_LOCK_TRY_FALSE',
    'A_ROLLBACK_CONFIRMED',
    'B_SAME_LOCK_TRY_TRUE',
    'B_AND_C_ROLLBACK_CONFIRMED'
  ]);
  assert.match(plan, /backend PID/);
});

test('permission probe never invokes review RPC', () => {
  assert.deepEqual(staging('S02').steps, [
    'RUNNER_DISABLED',
    'DIRECT_SELECT_DENIED',
    'DUE_RPC_ABSENT',
    'REVIEW_RPC_NOT_INVOKED'
  ]);
  assert.equal(staging('S02').durableWrites, false);
});

test('commit-order visibility test is restricted to disposable clone', () => {
  assert.equal(clone('C01').commitRequired, true);
  assert.equal(clone('C01').expected, '200_XP_NO_DEMOTION_AFTER_COMMIT');
  assert.match(plan, /READ COMMITTED/);
});

test('writer rollback cannot be mistaken for a sealed review', () => {
  assert.equal(clone('C02').commitRequired, false);
  assert.equal(clone('C02').expected, '199_XP_HELD_WITHOUT_SEAL');
});

test('backdated XP and corrections are held', () => {
  assert.equal(clone('C03').expected, 'DURABLE_QUARANTINE_OR_HELD');
  assert.equal(clone('C04').expected, 'SERIALIZED_HELD');
  assert.match(plan, /HELD/);
});

test('cross-user locks require deterministic order', () => {
  assert.equal(clone('C05').expected, 'NO_DEADLOCK');
  assert.match(plan, /UUID/);
});

test('beta cutover remains blocked until verified separately', () => {
  assert.equal(clone('C06').expected, 'CUTOVER_UNAPPROVED_HELD');
  assert.match(plan, /cutover/);
});

test('future private due RPC is bound to 25 users without direct SELECT', () => {
  assert.equal(clone('C07').expected, 'UP_TO_25_NO_DIRECT_SELECT');
  assert.match(plan, /No GRANT SELECT/);
});

test('postchecks demand exact state and wallet equality', () => {
  for (const expected of [
    'LEVEL_ANCHOR_REVISION_EXACT_MATCH',
    'WALLET_BALANCES_AND_REVISION_EXACT_MATCH',
    'REVIEW_CLAIMS_XP_AND_POINT_FINGERPRINT_UNCHANGED'
  ]) {
    assert.ok(matrix.postchecks.includes(expected), expected);
  }
});

test('postchecks verify no locks, transactions or catalog changes', () => {
  assert.ok(matrix.postchecks.includes('PROOF_LOCKS_AND_TRANSACTIONS_ZERO'));
  assert.ok(
    matrix.postchecks.includes('CATALOG_PRIVILEGES_TRIGGERS_UNCHANGED')
  );
});

test('abnormal SHA, session, lock or rollback failures all stop', () => {
  for (const expected of [
    'UNEXPECTED_SHA_OR_ENVIRONMENT',
    'UNSTABLE_OR_MIXED_SESSION',
    'ROLLBACK_UNVERIFIED',
    'LOCK_CONTENTION_MISMATCH_OR_DEADLOCK',
    'POSTCHECK_DIFF_OR_MISSING_EVIDENCE'
  ]) {
    assert.ok(matrix.stop.includes(expected), expected);
  }
});

test('seal, beta cutover and due RPC remain release blockers', () => {
  for (const expected of [
    'WINDOW_SEAL_OR_LATE_XP_POLICY_MISSING',
    'BETA_CUTOVER_NOT_APPROVED',
    'PRIVATE_DUE_RPC_OR_PRIVILEGE_MISSING'
  ]) {
    assert.ok(matrix.stop.includes(expected), expected);
  }
});

test('plan makes no executable migration or release claim', () => {
  assert.match(plan, /PLAN_VALIDATED/);
  assert.match(plan, /STAGING_PROVEN/);
  assert.match(plan, /DO NOT EXECUTE/);
  assert.doesNotMatch(plan, /^\s*CREATE\s+FUNCTION/im);
  assert.doesNotMatch(plan, /^\s*GRANT\s+SELECT/im);
});
