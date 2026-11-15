import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_MIXED_BETA_POINT_UNITS,
  quoteScoutOfflineBetaHandoff,
  reconcileScoutOfflineOpening
} from '../api/_lib/reader-reward/formal-cutover-offline.js';

const reader = '00000000-0000-4000-8000-000000000401';
const originalId = '00000000-0000-4000-8000-000000000411';
const reversalId = '00000000-0000-4000-8000-000000000412';
const alreadyTenfoldId = '00000000-0000-4000-8000-000000000413';
const release = Date.parse('2026-12-01T00:00:00.000Z');
const oldUnit = 'beta_one_point_per_yen';
const newUnit = 'beta_ten_points_per_yen';
const betaThresholdRows = Array.from({ length: 30 }, (_, index) => {
  const level = index + 1;
  return {
    level,
    cumulative_xp:
      level === 1 ? 0 : (level - 1) * 50 + 10 * (level - 2) * (level - 1),
    rule_version: 'beta-2026-09-21'
  };
});

function handoff(rows, ledgerUnitVersion = SCOUT_MIXED_BETA_POINT_UNITS) {
  return quoteScoutOfflineBetaHandoff({
    ledgerUnitVersion,
    betaThresholdRows,
    formalReleaseAtMs: release,
    accounts: [
      {
        userId: reader,
        accountCreatedAtMs: Date.parse('2026-10-01T00:00:00.000Z'),
        verifiedBetaLedgerXp: 9570,
        betaSummary: {
          level: 30,
          total_xp: 9570,
          xp_into_level: 0,
          xp_for_next_level: 0,
          beta_level_max: true
        }
      }
    ],
    canonicalLedgerRows: rows
  });
}

const rows = [
  {
    id: originalId,
    user_id: reader,
    event_key: 'beta:badge:before-future-award-unit-change',
    point_kind: 'badge',
    point_value: 400,
    status: 'confirmed',
    reversal_of: null,
    sourceUnitVersion: oldUnit
  },
  {
    id: reversalId,
    user_id: reader,
    event_key: 'beta:reversal',
    point_kind: 'adjustment',
    point_value: -25,
    status: 'confirmed',
    reversal_of: originalId,
    sourceUnitVersion: oldUnit
  },
  {
    id: alreadyTenfoldId,
    user_id: reader,
    event_key: 'level_up:' + reader + ':30',
    point_kind: 'level_up',
    point_value: 50,
    status: 'confirmed',
    reversal_of: null,
    sourceUnitVersion: newUnit
  }
];

test('mixed-source offline cutover converts only old Point rows, preserves new-unit awards', () => {
  const result = handoff(rows);
  assert.equal(result.status, 'offline_handoff_quote_only');
  assert.deepEqual(
    result.convertedRows.map((row) => row.convertedValue),
    [4000, -250, 50]
  );
  assert.deepEqual(
    result.convertedRows.map((row) => row.sourceUnitVersion),
    [oldUnit, oldUnit, newUnit]
  );
  assert.equal(result.summary.originalConfirmedNet, null);
  assert.equal(result.summary.legacyOriginalConfirmedNet, 375);
  assert.equal(result.summary.alreadyTenfoldConfirmedNet, 50);
  assert.equal(result.summary.convertedConfirmedNet, 3800);
  assert.equal(result.summary.legacyRowsConverted, 2);
  assert.equal(result.summary.alreadyTenfoldRowsPreserved, 1);
  assert.equal(result.walletSeeds[0].availablePoints, 3800);
  assert.equal(result.walletSeeds[0].exchangeEligiblePoints, 0);
  assert.equal(result.walletSeeds[0].openingAlreadyTenfoldPoints, 50);
  assert.equal(result.cutoverWasExecuted, false);
  assert.equal(result.liveEvidenceVerified, false);
  assert.equal(result.mayMigrateDb, false);
  assert.equal(result.mayRedeem, false);
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: result,
      convertedLedgerRows: result.convertedRows
    }).status,
    'offline_opening_reconciled'
  );
});

test('row-by-row units are mandatory and old-only input refuses already converted rows', () => {
  const missing = rows.map((row) => ({ ...row }));
  delete missing[2].sourceUnitVersion;
  assert.equal(
    handoff(missing).status,
    'legacy_ledger_identity_or_version_invalid'
  );
  assert.equal(
    handoff(rows, oldUnit).status,
    'legacy_ledger_identity_or_version_invalid'
  );
  assert.equal(
    handoff(rows, newUnit).status,
    'legacy_point_unit_not_verified'
  );
  const unknown = rows.map((row) => ({ ...row }));
  unknown[2].sourceUnitVersion = 'unverified';
  assert.equal(
    handoff(unknown).status,
    'legacy_ledger_identity_or_version_invalid'
  );
});

test('already-tenfold Point rows cannot exceed canonical ledger limits', () => {
  const invalid = rows.map((row) => ({ ...row }));
  invalid[2].point_value = 1_000_001;
  assert.equal(
    handoff(invalid).status,
    'already_tenfold_ledger_point_overflow'
  );
});

test('reversals use converted units; an over-reversal is held', () => {
  const differentUnits = rows.map((row) => ({ ...row }));
  differentUnits[1].sourceUnitVersion = newUnit;
  differentUnits[1].point_value = -250;
  const valid = handoff(differentUnits);
  assert.equal(valid.status, 'offline_handoff_quote_only');
  assert.equal(valid.walletSeeds[0].availablePoints, 3800);
  differentUnits[1].point_value = -4001;
  assert.equal(
    handoff(differentUnits).status,
    'legacy_reversal_exceeds_original'
  );
});

test('opening reconciliation detects source unit tampering after the quote', () => {
  const baseline = handoff(rows);
  assert.equal(baseline.status, 'offline_handoff_quote_only');
  const tampered = baseline.convertedRows.map((row) => ({ ...row }));
  tampered[2].sourceUnitVersion = oldUnit;
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: baseline,
      convertedLedgerRows: tampered
    }).status,
    'opening_ledger_value_mismatch'
  );
});
