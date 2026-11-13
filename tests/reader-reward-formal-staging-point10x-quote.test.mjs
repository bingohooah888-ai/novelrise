import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteStagingHistoricalPoint10x } from '../api/_lib/reader-reward/formal-staging-point10x-quote.js';

const staging = 'wmlzjgvxgoyrovdhbqbg';
const snapshot = Object.freeze({
  ledgerRows: 3581,
  ledgerUsers: 1605,
  matchedAuthUsers: 1,
  unmatchedAuthUsers: 1604,
  legacyBadgeRows: 3581,
  legacyBadgeNet: 3581,
  confirmedNet: 3581,
  unsettledRows: 0,
  reversalRows: 0,
  negativeRows: 0
});
const quote = (overrides = {}) =>
  quoteStagingHistoricalPoint10x({
    projectRef: staging,
    sourceUnitVersion: 'beta_one_point_per_yen',
    snapshot: { ...snapshot, ...overrides }
  });

test('actual Staging aggregates quote 3581 to 35810, but forbid excluding 1604 unknown users', () => {
  const result = quote();
  assert.equal(result.status, 'point10x_read_only_quote');
  assert.equal(result.proposed.legacyBadgeNet, 3581);
  assert.equal(result.proposed.convertedBadgeNet, 35810);
  assert.equal(result.proposed.delta, 32229);
  assert.equal(result.proposed.proposedConfirmedNet, 35810);
  assert.equal(result.proposed.unresolvedAuthUsers, 1604);
  assert.ok(result.blockers.includes('ledger_user_identity_unresolved'));
  assert.equal(result.mayWriteDb, false);
  assert.equal(result.maySkipUnmatchedUsers, false);
});

test('even a synthetic fully matched cohort yields a quote only, never execution rights', () => {
  const result = quote({ matchedAuthUsers: 1605, unmatchedAuthUsers: 0 });
  assert.equal(result.proposed.convertedBadgeNet, 35810);
  assert.equal(result.proposed.identityWhitelistVerified, false);
  assert.equal(result.proposed.sourceSnapshotComplete, false);
  assert.equal(result.mayWriteDb, false);
  assert.ok(
    result.blockers.includes('source_and_auth_provenance_not_attested')
  );
});

test('reject other projects, unit ambiguity and impossible user counts', () => {
  assert.equal(
    quoteStagingHistoricalPoint10x({
      projectRef: 'fiepaguycecrredwrcwx',
      sourceUnitVersion: 'beta_one_point_per_yen',
      snapshot
    }).reason,
    'not_staging'
  );
  assert.equal(
    quoteStagingHistoricalPoint10x({
      projectRef: staging,
      sourceUnitVersion: 'beta_ten_points_per_yen',
      snapshot
    }).reason,
    'historical_source_unit_unverified'
  );
  assert.equal(
    quote({ matchedAuthUsers: 10 }).reason,
    'source_aggregate_inconsistent'
  );
});

test('future formal Points are not multiplied when source is mixed', () => {
  const result = quote({
    ledgerRows: 3582,
    ledgerUsers: 1605,
    legacyBadgeRows: 3581,
    legacyBadgeNet: 3581,
    confirmedNet: 3591
  });
  assert.equal(result.proposed.proposedConfirmedNet, 35820);
  assert.equal(result.proposed.unchangedOtherPoints, 10);
  assert.ok(
    result.blockers.includes(
      'mixed_unit_rows_require_independent_classification'
    )
  );
});

test('unsettled rows and overflow stay blocked; quote cannot create an auth identity', () => {
  const unsettled = quote({ unsettledRows: 1 });
  assert.ok(
    unsettled.blockers.includes(
      'unsettled_reversal_or_negative_requires_policy'
    )
  );
  assert.equal(unsettled.mayCreateAuthUsers, false);
  assert.equal(
    quote({ legacyBadgeNet: 100001 }).reason,
    'source_aggregate_inconsistent'
  ); // net sum must cover historical ledger
});
