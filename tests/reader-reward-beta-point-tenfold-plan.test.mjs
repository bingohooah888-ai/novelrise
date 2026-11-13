import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_POINT_UNIT_SCALE,
  SCOUT_POINT_EXTERNAL_MINIMUM,
  SCOUT_POINT_INVOICE_YEN,
  SCOUT_POINT_LEGACY_VERSION,
  SCOUT_POINT_TARGET_VERSION,
  quoteScoutPointTenfoldValue,
  quoteScoutBetaTenfoldCutover
} from '../api/_lib/reader-reward/beta-point-tenfold-plan.js';

const aggregate = (part = {}) => ({
  // Metadata-only aggregate observed in the current live database on 2026-11-05.
  ledgerRows: 132,
  affectedUsers: 36,
  oldLedgerPoints: 172,
  reversalRows: 0,
  nonconfirmedRows: 0,
  negativeRows: 0,
  operatorAmountRows: 0,
  badgeDefinitionRows: 182,
  badgeLegacyRewardSum: 835,
  pointMetricBadgeCount: 2,
  pointMetricProgressRows: 360,
  ...part
});
const context = (part = {}) => ({
  fromVersion: SCOUT_POINT_LEGACY_VERSION,
  toVersion: SCOUT_POINT_TARGET_VERSION,
  expectedLedgerRows: 132,
  expectedLegacySum: 172,
  expectedAffectedUsers: 36,
  ...part
});
const plan = (changes = {}) =>
  quoteScoutBetaTenfoldCutover({
    snapshot: aggregate(),
    context: context(),
    prerequisiteChecks: {},
    ...changes
  });
const noEffects = (q) => {
  assert.equal(q.migrationWasRun, false);
  assert.equal(q.liveSnapshotVerified, false);
  assert.equal(q.mayWriteDb, false);
  assert.equal(q.mayChangeProduction, false);
  assert.equal(q.mayGrantPoints, false);
  assert.equal(q.mayRedeem, false);
};

test('approved new unit is ten integer Point per yen and 30000pt redemption floor', () => {
  assert.equal(SCOUT_POINT_UNIT_SCALE, 10);
  assert.equal(SCOUT_POINT_EXTERNAL_MINIMUM, 30000);
  assert.equal(SCOUT_POINT_INVOICE_YEN, 3000);
});
test('legacy 100 points would become 1000 in new units, without real writes', () => {
  const q = quoteScoutPointTenfoldValue({ legacyValue: 100 });
  assert.equal(q.status, 'tenfold_value_quote_only');
  assert.equal(q.proposedValue, 1000);
  noEffects(q);
});
test('legacy negative reversal value is scaled symmetrically and safely', () => {
  const q = quoteScoutPointTenfoldValue({ legacyValue: -5 });
  assert.equal(q.proposedValue, -50);
  noEffects(q);
});
test('zero value stays zero', () => {
  assert.equal(
    quoteScoutPointTenfoldValue({ legacyValue: 0 }).proposedValue,
    0
  );
});
test('a previously converted version is held rather than multiplied again', () => {
  const q = quoteScoutPointTenfoldValue({
    legacyValue: 1000,
    sourceVersion: SCOUT_POINT_TARGET_VERSION
  });
  assert.equal(q.status, 'already_converted_or_version_unverified_hold');
  noEffects(q);
});
test('ledger row exceeding the existing check constraint after x10 is held', () => {
  const q = quoteScoutPointTenfoldValue({ legacyValue: 100001 });
  assert.equal(q.status, 'column_constraint_overflow_hold');
  noEffects(q);
});
test('operator adjustment exceeding its existing check constraint is held', () => {
  const q = quoteScoutPointTenfoldValue({
    legacyValue: 10001,
    field: 'operator_adjustment_amount'
  });
  assert.equal(q.status, 'column_constraint_overflow_hold');
});
test('existing badge reward and point-based threshold can be scaled independently', () => {
  assert.equal(
    quoteScoutPointTenfoldValue({
      legacyValue: 835,
      field: 'badge_point_reward'
    }).proposedValue,
    8350
  );
  assert.equal(
    quoteScoutPointTenfoldValue({
      legacyValue: 100,
      field: 'point_metric_target'
    }).proposedValue,
    1000
  );
  assert.equal(
    quoteScoutPointTenfoldValue({
      legacyValue: 500,
      field: 'point_metric_target'
    }).proposedValue,
    5000
  );
});
test('unrelated XP or count fields are rejected as conversion targets', () => {
  assert.throws(
    () =>
      quoteScoutPointTenfoldValue({
        legacyValue: 200,
        field: 'xp_value'
      }),
    TypeError
  );
  assert.throws(
    () =>
      quoteScoutPointTenfoldValue({
        legacyValue: 1.5
      }),
    TypeError
  );
});
test('aggregated live metadata gives 132 unchanged ledger rows and 1720 projected points', () => {
  const q = plan();
  assert.equal(q.status, 'cutover_preflight_plan_only');
  assert.equal(q.original.ledgerRows, 132);
  assert.equal(q.original.affectedUsers, 36);
  assert.equal(q.original.ledgerPoints, 172);
  assert.equal(q.proposed.ledgerRows, 132);
  assert.equal(q.proposed.affectedUsers, 36);
  assert.equal(q.proposed.ledgerPoints, 1720);
  noEffects(q);
});
test('182 badge definitions remain 182; 835 existing reward total becomes 8350', () => {
  const q = plan();
  assert.equal(q.original.badgeDefinitionRows, 182);
  assert.equal(q.original.badgePointsTotal, 835);
  assert.equal(q.proposed.badgeDefinitionRows, 182);
  assert.equal(q.proposed.badgePointsTotal, 8350);
});
test('two point-metric badges and 360 badge progress records require explicit reconciliation', () => {
  const q = plan();
  assert.equal(q.proposed.pointMetricBadgeCount, 2);
  assert.equal(q.proposed.pointMetricProgressRows, 360);
  assert.ok(
    q.unresolvedEvidence.includes('pointMetricThresholdsAndProgressInventoried')
  );
});
test('preflight requires current signed counts, not last week snapshots', () => {
  for (const c of [
    { expectedLedgerRows: 131 },
    { expectedLegacySum: 173 },
    { expectedAffectedUsers: 35 },
    { fromVersion: SCOUT_POINT_TARGET_VERSION }
  ]) {
    const q = plan({ context: context(c) });
    assert.equal(q.status, 'snapshot_version_or_count_mismatch_hold');
    noEffects(q);
  }
});
test('changed ledger aggregates block a stale cutover despite matching old intent', () => {
  for (const part of [
    { ledgerRows: 133 },
    { oldLedgerPoints: 200 },
    { affectedUsers: 37 }
  ]) {
    const q = plan({ snapshot: aggregate(part) });
    assert.equal(q.status, 'snapshot_version_or_count_mismatch_hold');
  }
});
test('inconsistent aggregate relationships are held', () => {
  const q = plan({ snapshot: aggregate({ affectedUsers: 150 }) });
  assert.equal(q.status, 'inconsistent_aggregate_hold');
});
test('corrupt aggregate fields and mismatched schema types are rejected', () => {
  assert.throws(
    () => plan({ snapshot: aggregate({ ledgerRows: -1 }) }),
    TypeError
  );
  assert.throws(
    () => plan({ snapshot: aggregate({ oldLedgerPoints: 0.1 }) }),
    TypeError
  );
  assert.throws(() => plan({ prerequisiteChecks: null }), TypeError);
});
test('all self-certified prerequisites still cannot operate a production database', () => {
  const initial = plan();
  const all = Object.fromEntries(initial.checksToVerify.map((k) => [k, true]));
  const q = plan({ prerequisiteChecks: all });
  assert.deepEqual(q.unresolvedEvidence, []);
  assert.equal(q.requiresSeparateSpecificProductionDbApproval, true);
  assert.equal(q.automaticConversionAuthorized, false);
  assert.equal(q.independentlyTestedOnLiveDatabase, false);
  noEffects(q);
});
test('only Point-valued fields are targeted, leaving XP and usage counters unchanged', () => {
  const q = plan();
  assert.ok(q.doNotTouch.includes('scout_xp_ledger'));
  assert.ok(q.doNotTouch.includes('scout_badge_metric_events'));
  assert.ok(q.doNotTouch.includes('scout_level_thresholds'));
});
test('operator actions and reversals are explicit blockers when found later', () => {
  const q = plan({
    snapshot: aggregate({
      reversalRows: 1,
      negativeRows: 1,
      operatorAmountRows: 1
    })
  });
  assert.equal(q.original.operatorAmountRows, 1);
  assert.ok(
    q.unresolvedEvidence.includes('adminAdjustmentsAndReversalsInventoried')
  );
  noEffects(q);
});
