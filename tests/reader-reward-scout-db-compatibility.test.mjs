import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditScoutDbCompatibility,
  validateScoutBetaThresholds,
  quoteScoutBetaToFormalHandoff
} from '../api/_lib/reader-reward/scout-db-compatibility.js';

const day = 86400000;
const release = Date.UTC(2027, 0, 1, 12); // Test ONLY, no launch date approved.
const betaRows = Object.freeze(Array.from({ length: 30 }, (_, i) => {
  const level = i + 1;
  return Object.freeze({
    level,
    cumulative_xp: 10 * i * (i + 4),
    rule_version: 'beta-2026-09-21'
  });
}));

// Fixtures are limited to verified *metadata*, not user or secret records.
// Observed read-only on 2026-11-05; not an immutable production snapshot.
const observed = () => ({
  tables: {
    scout_xp_ledger: {
      columns: ['id', 'user_id', 'source_event_id', 'xp_kind', 'xp_value', 'rule_version', 'occurred_at'],
      rlsEnabled: true
    },
    scout_event_ledger: {
      columns: ['id', 'user_id', 'event_type', 'event_key', 'occurred_at'],
      rlsEnabled: true
    },
    scout_level_thresholds: {
      columns: ['level', 'cumulative_xp', 'rule_version'],
      rlsEnabled: true
    }
  },
  uniqueKeys: [
    { tableName: 'scout_xp_ledger', columns: ['user_id', 'source_event_id', 'xp_kind'] },
    { tableName: 'scout_event_ledger', columns: ['event_key'] }
  ],
  triggers: [
    { tableName: 'scout_xp_ledger', name: 'scout_xp_beta_level_cap' },
    { tableName: 'scout_xp_ledger', name: 'scout_xp_level_up_points' },
    { tableName: 'scout_xp_ledger', name: 'scout_xp_refresh_reader_badges' },
    { tableName: 'scout_event_ledger', name: 'scout_event_valid_read_xp' }
  ],
  functions: [
    'novelight_scout_record_summary',
    'novelight_scout_level_for_xp',
    'novelight_award_level_up_points',
    'novelight_cap_scout_xp_beta'
  ],
  formalStateContract: null,
  formalReviewClaimContract: null
});
const betaSummary = (edits = {}) => ({
  level: 29,
  total_xp: 9000,
  raw_recorded_xp: 9000,
  xp_into_level: 40,
  xp_for_next_level: 610,
  beta_level_max: false,
  ...edits
});

test('read-only observed beta schema is not ready for formal reward release', () => {
  const result = auditScoutDbCompatibility(observed());
  assert.equal(result.status, 'cutover_not_authorized');
  assert.equal(result.productionCutoverAllowed, false);
  assert.equal(result.preservesBeta, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.blockers.includes('active_beta_trigger:scout_xp_beta_level_cap'), true);
  assert.equal(result.blockers.includes('active_beta_trigger:scout_xp_level_up_points'), true);
  assert.equal(result.blockers.includes('legacy_summary_uses_cumulative_xp'), true);
  assert.equal(result.blockers.includes('formal_progress_state_not_verified'), true);
  assert.equal(result.blockers.includes('formal_review_uniqueness_not_verified'), true);
  assert.equal(result.blockers.includes('xp_source_uniqueness_not_verified'), false);
  assert.equal(result.blockers.includes('event_uniqueness_not_verified'), false);
});

test('missing XP idempotency, columns, or RLS trigger safe blockers', () => {
  const x = observed();
  x.uniqueKeys = [];
  x.tables.scout_xp_ledger.rlsEnabled = false;
  x.tables.scout_event_ledger.columns = ['id', 'user_id'];
  x.triggers = [];
  const result = auditScoutDbCompatibility(x);
  assert.equal(result.productionCutoverAllowed, false);
  for (const blocker of [
    'xp_source_uniqueness_not_verified',
    'event_uniqueness_not_verified',
    'rls_not_verified:scout_xp_ledger',
    'missing_existing_columns:scout_event_ledger',
    'beta_scaffold_trigger_missing:scout_event_valid_read_xp'
  ]) {
    assert.equal(result.blockers.includes(blocker), true, blocker);
  }
});

test('even hypothetical complete cutover metadata cannot grant production approval', () => {
  const x = observed();
  x.triggers = x.triggers.filter(v =>
    !['scout_xp_beta_level_cap', 'scout_xp_level_up_points'].includes(v.name)
  );
  x.functions = x.functions.filter(v => v !== 'novelight_scout_record_summary');
  x.formalStateContract = {
    verified: true,
    hasProgressAndPeak: true,
    hasRevisionCas: true
  };
  x.formalReviewClaimContract = {
    verified: true,
    hasUserWindowUniqueKey: true,
    sameTransactionAsState: true
  };
  const result = auditScoutDbCompatibility(x);
  assert.equal(result.productionCutoverAllowed, false);
  assert.equal(result.status, 'cutover_not_authorized');
  assert.equal(Object.hasOwn(result, 'readyToDeploy'), false);
});

test('beta 1-30 ladder is validated without extending it to Lv.31', () => {
  const result = validateScoutBetaThresholds(betaRows);
  assert.equal(result.ruleVersion, 'beta-2026-09-21');
  assert.equal(result.cumulativeByLevel[1], 0);
  assert.equal(result.cumulativeByLevel[10], 1170);
  assert.equal(result.cumulativeByLevel[20], 4370);
  assert.equal(result.cumulativeByLevel[30], 9570);
  assert.equal(Object.hasOwn(result.cumulativeByLevel, '31'), false);
  assert.equal(Object.isFrozen(result.cumulativeByLevel), true);
});

test('malformed or extrapolated Level 31 thresholds cannot enter the beta bridge', () => {
  assert.throws(() => validateScoutBetaThresholds([
    ...betaRows,
    { level: 31, cumulative_xp: 10200, rule_version: 'unapproved' }
  ]), RangeError);
  assert.throws(() => validateScoutBetaThresholds(betaRows.slice(1)), RangeError);
  assert.throws(() => validateScoutBetaThresholds(betaRows.map((x, i) =>
    i === 12 ? { ...x, rule_version: 'other' } : x
  )), RangeError);
  assert.throws(() => validateScoutBetaThresholds(betaRows.map((x, i) =>
    i === 20 ? { ...x, cumulative_xp: 1 } : x
  )), RangeError);
});

test('beta Lv.29 handoff preserves only Level/XP gauge/peak with release review anchor', () => {
  const result = quoteScoutBetaToFormalHandoff({
    authenticatedBetaSummary: betaSummary(),
    betaThresholdRows: betaRows,
    formalReleaseAtMs: release,
    accountCreatedAtMs: release - 100 * day
  });
  assert.equal(result.status, 'handoff_quote_only');
  assert.equal(result.ready, false);
  assert.deepEqual(result.proposed, {
    currentLevel: 29,
    highestLevel: 29,
    levelProgressXp: 40,
    reviewAnchorMs: release
  });
  assert.equal(result.firstReviewDueAtMs, release + 30 * day);
  assert.equal(Object.hasOwn(result.proposed, 'totalXp'), false);
  assert.equal(Object.hasOwn(result.proposed, 'rawRecordedXp'), false);
  assert.equal(Object.isFrozen(result.proposed), true);
  assert.equal(result.requiresServerLedgerCrossCheck, true);
});

test('already maxed beta Level 30 has no beta XP overflow carried to Level 31', () => {
  const result = quoteScoutBetaToFormalHandoff({
    authenticatedBetaSummary: betaSummary({
      level: 30,
      total_xp: 9570,
      raw_recorded_xp: 15000, // legacy display is NOT a formal level progress source
      xp_into_level: 0,
      xp_for_next_level: 0,
      beta_level_max: true
    }),
    betaThresholdRows: betaRows,
    formalReleaseAtMs: release,
    accountCreatedAtMs: release - 200 * day
  });
  assert.equal(result.status, 'handoff_quote_only');
  assert.equal(result.proposed.currentLevel, 30);
  assert.equal(result.proposed.levelProgressXp, 0);
  assert.equal(result.requiresFormalThresholdApproval, true);
});

test('post-release registrations must never import legacy beta level state', () => {
  const signup = release + 10 * day;
  const result = quoteScoutBetaToFormalHandoff({
    authenticatedBetaSummary: betaSummary(),
    betaThresholdRows: betaRows,
    formalReleaseAtMs: release,
    accountCreatedAtMs: signup
  });
  assert.equal(result.status, 'postrelease_registration_not_beta_handoff');
  assert.equal(result.ready, false);
  assert.equal(Object.hasOwn(result, 'proposed'), false);
  // The already-approved signup + 30-day window remains handled by
  // quoteScoutFirstDemotionReviewWindow, not by a beta account migration.
});

test('bad summary level and XP inconsistencies block conversion', () => {
  for (const mutation of [
    { level: 30, beta_level_max: false },
    { total_xp: 9570 },
    { xp_into_level: 9999 },
    { xp_for_next_level: 609 },
    { beta_level_max: true },
    { level: 31 },
    { total_xp: -1 },
    { xp_into_level: '40' },
    { level: '29' },
    { xp_for_next_level: null }
  ]) {
    const fn = () => quoteScoutBetaToFormalHandoff({
      authenticatedBetaSummary: betaSummary(mutation),
      betaThresholdRows: betaRows,
      formalReleaseAtMs: release,
      accountCreatedAtMs: release - day
    });
    let output;
    try {
      output = fn();
      assert.equal(output.status, 'beta_summary_mismatch');
      assert.equal(output.ready, false);
    } catch (e) {
      assert.equal(e instanceof TypeError || e instanceof RangeError, true);
    }
  }
});

test('corrupt input data cannot bypass the contract by claiming readiness', () => {
  for (const value of [null, {}, { tables: {}, uniqueKeys: [], triggers: [] }]) {
    assert.throws(() => auditScoutDbCompatibility(value), TypeError);
  }
  const forged = observed();
  forged.productionCutoverAllowed = true;
  const result = auditScoutDbCompatibility(forged);
  assert.equal(result.productionCutoverAllowed, false);
});
