import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessSpecialBranchReadiness,
  SPECIAL_BRANCH_MAX_INITIALIZATION_MS
} from '../scripts/special-branch-readiness.mjs';

const productionRef = 'fiepaguycecrredwrcwx';
const sharedStagingRef = 'wmlzjgvxgoyrovdhbqbg';
const branchRef = 'vbqyrmygqjkqibydovwc';
const branchId = '7503040e-f770-455a-9d40-46d316e58312';
const history = Array.from({ length: 190 }, (_, i) => ({
  version: `2026${String(i).padStart(10, '0')}`,
  name: `test-${i}`
}));
function sample({
  count = 190,
  status = 'FUNCTIONS_DEPLOYED',
  elapsedMs = 1000,
  branchOverride,
  migrationOverride
} = {}) {
  return assessSpecialBranchReadiness({
    branches: [
      {
        id: branchId,
        name: 'special-2442-disposable-20261023',
        project_ref: branchRef,
        parent_project_ref: productionRef,
        is_default: false,
        with_data: false,
        status,
        ...branchOverride
      }
    ],
    migrations: migrationOverride ?? history.slice(0, count),
    productionMigrations: history,
    branchId,
    branchRef,
    productionRef,
    sharedStagingRef,
    elapsedMs
  });
}

test('28 of 190 migrations is still initializing, never safe to apply SPECIAL', () => {
  const result = sample({ count: 28 });
  assert.equal(result.verdict, 'wait');
  assert.equal(result.reason, 'MIGRATIONS_STILL_INCOMPLETE');
  assert.equal(result.observed, 28);
  assert.equal(result.expected, 190);
  assert.equal(result.canApplySpecial, false);
});
test('all migrations plus provider terminal-ready status unlocks only the readiness verdict', () => {
  const result = sample();
  assert.equal(result.verdict, 'ready');
  assert.equal(result.canApplySpecial, true);
});
test('all 190 migrations while provider still provisioning must wait', () => {
  const result = sample({ status: 'CREATING_PROJECT' });
  assert.equal(result.verdict, 'wait');
  assert.equal(result.reason, 'PROVIDER_NOT_READY');
});
test('explicit provider migration failure stops immediately', () => {
  assert.equal(
    sample({ count: 28, status: 'MIGRATIONS_FAILED' }).reason,
    'PROVIDER_MIGRATION_FAILED'
  );
});
test('bounded startup timeout stops, not ignores, incomplete migration history', () => {
  assert.equal(
    sample({ count: 28, elapsedMs: SPECIAL_BRANCH_MAX_INITIALIZATION_MS })
      .reason,
    'INITIALIZATION_TIMEOUT_OR_INVALID_CLOCK'
  );
});
test('never allow Production or existing Staging as an ephemeral target', () => {
  assert.equal(
    sample({ branchOverride: { project_ref: productionRef } }).reason,
    'TARGET_ISOLATION_MISMATCH'
  );
  assert.equal(
    sample({ branchOverride: { is_default: true } }).reason,
    'TARGET_ISOLATION_MISMATCH'
  );
  assert.equal(
    sample({ branchOverride: { with_data: true } }).reason,
    'TARGET_ISOLATION_MISMATCH'
  );
  assert.equal(
    sample({ branchOverride: { parent_project_ref: sharedStagingRef } }).reason,
    'TARGET_ISOLATION_MISMATCH'
  );
});
test('unknown migration versions or duplicated versions stop and require investigation', () => {
  assert.equal(
    sample({
      count: 28,
      migrationOverride: [
        ...history.slice(0, 28),
        { version: '20990101000000', name: 'stranger' }
      ]
    }).reason,
    'UNEXPECTED_MIGRATION_HISTORY'
  );
  assert.equal(
    sample({ migrationOverride: [...history, history[0]] }).reason,
    'BRANCH_MIGRATIONS_UNAVAILABLE'
  );
});
test('missing or contradictory provider identity fails closed', () => {
  const args = {
    branches: [],
    migrations: history,
    productionMigrations: history,
    branchId,
    branchRef,
    productionRef,
    sharedStagingRef
  };
  assert.equal(
    assessSpecialBranchReadiness(args).reason,
    'NEW_BRANCH_NOT_FOUND'
  );
  assert.equal(
    assessSpecialBranchReadiness({
      ...args,
      branches: sampleBranch(),
      branchRef: productionRef
    }).reason,
    'PROJECT_REF_COLLISION'
  );
});
function sampleBranch() {
  return [
    {
      id: branchId,
      project_ref: branchRef,
      parent_project_ref: productionRef,
      is_default: false,
      with_data: false,
      status: 'FUNCTIONS_DEPLOYED'
    }
  ];
}
