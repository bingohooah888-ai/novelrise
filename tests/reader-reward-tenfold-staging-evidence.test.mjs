import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCOUT_TENFOLD_STAGING_SURFACES,
  quoteScoutTenfoldStagingShadow,
  verifyScoutTenfoldReconciliation,
  quoteScoutTenfoldRollbackEquality
} from '../api/_lib/reader-reward/tenfold-staging-evidence.js';

const PROD = 'fiepaguycecrredwrcwx';
const STAGE = 'wmlzjgvxgoyrovdhbqbg';
const production = {
  ledgerRows: 132,
  ledgerUsers: 36,
  ledgerSum: 172,
  distinctEventKeys: 132,
  badgeDefinitionRows: 182,
  badgeRewardSum: 835,
  pointBadgeCount: 2,
  pointProgressRows: 360,
  pointProgressSum: 344,
  pointEarnedRows: 0,
  operatorAmountRows: 0,
  operatorAmountSum: 0,
  nonconfirmedLedgerRows: 0,
  reversalRows: 0,
  pointOverflowRows: 0,
  badgeRewardOverflowRows: 0,
  progressOverflowRows: 0
};
const staging = {
  ...production,
  ledgerRows: 3581,
  ledgerUsers: 1605,
  ledgerSum: 3581,
  distinctEventKeys: 3581,
  pointProgressRows: 12870,
  pointProgressSum: 7162
};
const quote = (change = {}) =>
  quoteScoutTenfoldStagingShadow({
    productionRef: PROD,
    stagingRef: STAGE,
    production,
    staging,
    sameTableAndFunctionShape: true,
    sameFunctionAndTriggerDigests: true,
    ...change
  });
const neverExec = (result) => {
  for (const key of [
    'stagingWriteAllowed',
    'productionWriteAllowed',
    'mayExecuteSql',
    'maySettle',
    'mayRunAI',
    'mayMergeMain'
  ])
    assert.equal(result[key], false, key);
  assert.equal(result.evidenceIsReadOnly, true);
};
const DIGESTS = [
  'ledgerIdsDigest',
  'ledgerEventKeysDigest',
  'ledgerStatusesDigest',
  'ledgerUsersDigest',
  'sourceReferencesDigest',
  'earnedBadgesDigest',
  'nonPointProgressDigest',
  'xpAndRankDigest',
  'badgePercentageDigest'
];
const before = Object.freeze(
  Object.fromEntries([
    ...Object.entries(staging),
    ...DIGESTS.map((k) => [k, 'fixture-' + k])
  ])
);
const after = Object.freeze({
  ...before,
  ledgerSum: 35810,
  badgeRewardSum: 8350,
  pointProgressSum: 71620,
  operatorAmountSum: 0
});
const reconcile = (part = {}) =>
  verifyScoutTenfoldReconciliation({
    before,
    after: { ...after, ...part }
  });
const rollback = (change = {}) =>
  quoteScoutTenfoldRollbackEquality({
    before,
    afterRollback: { ...before },
    restoreBackupVerified: true,
    noNewWritesAfterSnapshot: true,
    markerStateRestoredVerified: true,
    levelUpFunctionRestoredVerified: true,
    ...change
  });

test('critical cutover surfaces include Point ledger and current level-up function', () => {
  assert.ok(
    SCOUT_TENFOLD_STAGING_SURFACES.includes('scout_point_ledger.point_value')
  );
  assert.ok(
    SCOUT_TENFOLD_STAGING_SURFACES.includes('novelight_award_level_up_points()')
  );
});
test('actual Staging metadata is read-only shadow PASS, never a migration approval', () => {
  const result = quote();
  assert.equal(result.status, 'read_only_shadow_pass_only');
  assert.equal(result.requiresOwnerStagingApproval, true);
  assert.equal(result.signedCurrentMainApprovalVerified, false);
  neverExec(result);
});
test('production and Staging identities are different and Staging is not a backup', () => {
  const result = quote();
  assert.equal(result.baseIsSeparateFromProduction, true);
  assert.equal(result.stagingDataMatchesProduction, false);
  assert.equal(result.stagingIsNotAProductionDataBackup, true);
});
test('Staging 3581 rows calculate 35810 Point and preserve 1605 users', () => {
  const x = quote().projected;
  assert.equal(x.ledgerRows, 3581);
  assert.equal(x.ledgerUsers, 1605);
  assert.equal(x.ledgerSum, 35810);
});
test('Staging 182 badge definitions total 835 becomes 8350', () => {
  const x = quote().projected;
  assert.equal(x.badgeDefinitionRows, 182);
  assert.equal(x.badgeRewardSum, 8350);
  assert.equal(x.pointBadgeCount, 2);
});
test('Staging 12870 Point progress rows are projected to a 71620 sum', () => {
  const x = quote().projected;
  assert.equal(x.pointProgressRows, 12870);
  assert.equal(x.pointProgressSum, 71620);
  assert.equal(x.pointEarnedRows, 0);
});
test('Production comparison is descriptive; it never permits Staging write', () => {
  const x = quote();
  assert.equal(x.productionAggregate.ledgerRows, 132);
  assert.equal(x.productionAggregate.ledgerSum, 172);
  assert.equal(x.productionAggregate.pointProgressRows, 360);
  neverExec(x);
});
test('incorrect project IDs block read-only readiness', () => {
  for (const x of [
    { stagingRef: PROD },
    { productionRef: STAGE },
    { stagingRef: 'unknown' },
    { productionRef: STAGE, stagingRef: PROD }
  ]) {
    const r = quote(x);
    assert.equal(r.status, 'project_identity_not_staging_or_production_hold');
    neverExec(r);
  }
});
test('unverified schema equivalence blocks shadows', () => {
  const x = quote({ sameTableAndFunctionShape: false });
  assert.ok(x.blockers.includes('schema_signature_unverified'));
  assert.equal(x.status, 'read_only_shadow_unverified_hold');
});
test('different database functions or trigger definitions are blockers', () => {
  const x = quote({ sameFunctionAndTriggerDigests: false });
  assert.ok(x.blockers.includes('function_or_trigger_drift'));
});
test('duplicate event keys make projected ledger unusable', () => {
  const x = quote({ staging: { ...staging, distinctEventKeys: 3580 } });
  assert.ok(x.blockers.includes('duplicate_event_keys'));
});
test('existing Point bound overflow blocks cutover preview', () => {
  const x = quote({ staging: { ...staging, pointOverflowRows: 1 } });
  assert.ok(x.blockers.includes('point_constraint_overflow'));
});
test('reward definition integer overflow blocks preview', () => {
  const x = quote({ staging: { ...staging, badgeRewardOverflowRows: 1 } });
  assert.ok(x.blockers.includes('badge_reward_overflow'));
});
test('Point progress bigint overflow blocks preview', () => {
  const x = quote({ staging: { ...staging, progressOverflowRows: 1 } });
  assert.ok(x.blockers.includes('point_badge_progress_overflow'));
});
test('unsafe aggregate tenfold calculation produces a hold', () => {
  const x = quote({
    staging: { ...staging, ledgerSum: Number.MAX_SAFE_INTEGER }
  });
  assert.ok(x.blockers.includes('aggregate_ledger_overflow'));
  assert.equal(x.projected.ledgerSum, null);
});
test('negative row counts and inconsistent users are rejected', () => {
  assert.throws(
    () => quote({ staging: { ...staging, ledgerRows: -1 } }),
    RangeError
  );
  assert.throws(
    () => quote({ staging: { ...staging, ledgerUsers: 4000 } }),
    RangeError
  );
});
test('fractional aggregates, missing inputs and fabricated types are rejected', () => {
  assert.throws(
    () => quote({ staging: { ...staging, pointProgressRows: 0.2 } }),
    TypeError
  );
  assert.throws(() => quote({ production: null }), TypeError);
});
test('a complete hypothetical postcutover snapshot can pass arithmetic only', () => {
  const r = reconcile();
  assert.equal(r.status, 'untrusted_snapshot_reconciliation_only');
  assert.equal(r.independentlyVerifiedDbTransaction, false);
  assert.equal(r.mayReleaseStaging, false);
  neverExec(r);
});
test('new Point ledger count cannot increase silently', () => {
  const r = reconcile({ ledgerRows: 3582 });
  assert.ok(r.mismatches.includes('immutable_ledgerRows'));
});
test('full ledger value must be exactly tenfold', () => {
  const r = reconcile({ ledgerSum: 35809 });
  assert.ok(r.mismatches.includes('tenfold_ledgerSum'));
});
test('reward definition total must be exactly tenfold', () => {
  const r = reconcile({ badgeRewardSum: 8349 });
  assert.ok(r.mismatches.includes('tenfold_badgeRewardSum'));
});
test('Point-linked badge progress must be exactly tenfold', () => {
  const r = reconcile({ pointProgressSum: 71619 });
  assert.ok(r.mismatches.includes('tenfold_pointProgressSum'));
});
test('status and event IDs cannot change even when sums match', () => {
  const r = reconcile({
    ledgerStatusesDigest: 'different',
    ledgerEventKeysDigest: 'different'
  });
  assert.ok(r.mismatches.includes('digest_ledgerStatusesDigest'));
  assert.ok(r.mismatches.includes('digest_ledgerEventKeysDigest'));
});
test('Scout XP and unrelated badge progress must remain unchanged', () => {
  const r = reconcile({
    xpAndRankDigest: 'modified',
    nonPointProgressDigest: 'modified'
  });
  assert.ok(r.mismatches.includes('digest_xpAndRankDigest'));
  assert.ok(r.mismatches.includes('digest_nonPointProgressDigest'));
});
test('Point badge earned status and percentages must remain unchanged', () => {
  const r = reconcile({
    earnedBadgesDigest: 'extra_badge',
    badgePercentageDigest: 'altered'
  });
  assert.ok(r.mismatches.includes('digest_earnedBadgesDigest'));
  assert.ok(r.mismatches.includes('digest_badgePercentageDigest'));
});
test('missing immutable digest always fails closed', () => {
  const r = reconcile({ ledgerUsersDigest: null });
  assert.ok(r.mismatches.includes('digest_ledgerUsersDigest'));
});
test('postcutover new range overflow is a hard hold', () => {
  const r = reconcile({ pointOverflowRows: 1 });
  assert.ok(r.mismatches.includes('pointOverflowRows'));
});
test('full snapshot equality and all caller flags never prove real rollback', () => {
  const r = rollback();
  assert.equal(r.status, 'untrusted_rollback_snapshot_equal_only');
  assert.equal(r.actualSupabaseRestoreVerified, false);
  assert.equal(r.requiresSeparateOwnerApproval, true);
  neverExec(r);
});
test('unverified full backup keeps rollback status held', () => {
  const r = rollback({ restoreBackupVerified: false });
  assert.equal(r.status, 'rollback_unverified_hold');
  assert.ok(r.outstandingProof.includes('independent_restore_proof'));
});
test('rollback without an exclusive write window must be denied', () => {
  const r = rollback({ noNewWritesAfterSnapshot: false });
  assert.equal(r.status, 'rollback_unverified_hold');
  assert.ok(r.outstandingProof.includes('cutover_exclusive_window'));
});
test('rollback fails if source Point ledger values differ', () => {
  const r = rollback({ afterRollback: { ...before, ledgerSum: 170 } });
  assert.ok(r.changedFields.includes('ledgerSum'));
  assert.equal(r.status, 'rollback_unverified_hold');
});
test('marker and award function restoration are independent requirements', () => {
  const r = rollback({
    markerStateRestoredVerified: false,
    levelUpFunctionRestoredVerified: false
  });
  assert.ok(r.outstandingProof.includes('durable_marker_restoration'));
  assert.ok(r.outstandingProof.includes('award_function_restoration'));
});
test('all result objects and arrays prevent caller mutation', () => {
  const r = quote();
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.projected));
  assert.ok(Object.isFrozen(r.blockers));
  assert.throws(() => {
    r.stagingWriteAllowed = true;
  }, TypeError);
});
