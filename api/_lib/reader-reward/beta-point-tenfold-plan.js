// OWNER draft: β Scout Point x10 policy and audit-only conversion model.
// No database, migration runner, future award trigger update, provider, or payout.
export const SCOUT_POINT_UNIT_SCALE = 10;
export const SCOUT_POINT_LEGACY_VERSION = 'beta_one_point_per_yen';
export const SCOUT_POINT_TARGET_VERSION = 'beta_ten_points_per_yen';
export const SCOUT_POINT_EXTERNAL_MINIMUM = 30000;
export const SCOUT_POINT_INVOICE_YEN = 3000;
const LIMIT = 1000000; // Current production scout_point_ledger CHECK, read-only audited.
const MAX_INT = 2147483647;
const isRecord = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const freeze = (v) => Object.freeze(v);
const safe = (v) => Number.isSafeInteger(v);
const quote = (status, extra = {}) =>
  freeze({
    status,
    ...extra,
    approvedPolicyOnly: true,
    migrationWasRun: false,
    liveSnapshotVerified: false,
    mayWriteDb: false,
    mayChangeProduction: false,
    mayGrantPoints: false,
    mayRedeem: false
  });

/**
 * The proposed conversion changes quantities, NOT historical event identity,
 * earned badge count, Scout XP, or the 3000-yen exchange face value.
 * A dry-run caller cannot attest to live database identity.
 */
export function quoteScoutPointTenfoldValue({
  legacyValue,
  sourceVersion = SCOUT_POINT_LEGACY_VERSION,
  field = 'ledger_point_value'
}) {
  if (sourceVersion !== SCOUT_POINT_LEGACY_VERSION) {
    return quote('already_converted_or_version_unverified_hold');
  }
  if (!safe(legacyValue))
    throw new TypeError('Legacy quantity must be an integer');
  if (
    ![
      'ledger_point_value',
      'badge_point_reward',
      'point_metric_target',
      'operator_adjustment_amount',
      'point_badge_progress'
    ].includes(field)
  ) {
    throw new TypeError(
      'Only audited Point-denominated fields may be converted'
    );
  }
  const bound =
    field === 'ledger_point_value'
      ? LIMIT
      : field === 'operator_adjustment_amount'
        ? 100000
        : MAX_INT;
  if (Math.abs(legacyValue) > Math.floor(bound / SCOUT_POINT_UNIT_SCALE)) {
    return quote('column_constraint_overflow_hold', { field });
  }
  return quote('tenfold_value_quote_only', {
    field,
    oldValue: legacyValue,
    proposedValue: legacyValue * SCOUT_POINT_UNIT_SCALE,
    sourceVersion,
    targetVersion: SCOUT_POINT_TARGET_VERSION
  });
}

/**
 * An aggregation-only, no-PII cutover review. It REQUIRES the production
 * point ledger AND badge/trigger/reader metric/progress surfaces to be
 * reconciled, but it cannot perform them or infer them from caller flags.
 */
export function quoteScoutBetaTenfoldCutover({
  snapshot,
  context,
  prerequisiteChecks = {}
}) {
  if (
    !isRecord(snapshot) ||
    !isRecord(context) ||
    !isRecord(prerequisiteChecks)
  ) {
    throw new TypeError('Aggregated snapshot and scope required');
  }
  const keys = [
    'ledgerRows',
    'affectedUsers',
    'oldLedgerPoints',
    'reversalRows',
    'nonconfirmedRows',
    'negativeRows',
    'operatorAmountRows',
    'badgeDefinitionRows',
    'badgeLegacyRewardSum',
    'pointMetricBadgeCount',
    'pointMetricProgressRows'
  ];
  for (const key of keys) {
    if (!safe(snapshot[key]) || snapshot[key] < 0) {
      throw new TypeError('Invalid non-PII aggregate: ' + key);
    }
  }
  if (
    snapshot.affectedUsers > snapshot.ledgerRows ||
    snapshot.reversalRows > snapshot.ledgerRows ||
    snapshot.nonconfirmedRows > snapshot.ledgerRows ||
    snapshot.negativeRows > snapshot.ledgerRows ||
    snapshot.pointMetricBadgeCount > snapshot.badgeDefinitionRows
  ) {
    return quote('inconsistent_aggregate_hold');
  }
  if (
    context.fromVersion !== SCOUT_POINT_LEGACY_VERSION ||
    context.toVersion !== SCOUT_POINT_TARGET_VERSION ||
    context.expectedLedgerRows !== snapshot.ledgerRows ||
    context.expectedLegacySum !== snapshot.oldLedgerPoints ||
    context.expectedAffectedUsers !== snapshot.affectedUsers
  ) {
    return quote('snapshot_version_or_count_mismatch_hold');
  }
  const total = quoteScoutPointTenfoldValue({
    legacyValue: snapshot.oldLedgerPoints
  });
  const badgeTotal = quoteScoutPointTenfoldValue({
    legacyValue: snapshot.badgeLegacyRewardSum,
    field: 'badge_point_reward'
  });
  if (
    total.status !== 'tenfold_value_quote_only' ||
    badgeTotal.status !== 'tenfold_value_quote_only'
  ) {
    return quote('aggregate_amount_overflow_or_unsupported_hold');
  }
  const needed = [
    'writerPathsAndSqlFunctionsInventoried',
    'badgeRewardDefinitionsAndPointMilestonesInventoried',
    'pointMetricThresholdsAndProgressInventoried',
    'adminAdjustmentsAndReversalsInventoried',
    'productionBackupAndRestoreRehearsed',
    'stagingCutoverAndRollbackVerified',
    'newOldWritesCannotMixUnderSingleCutover',
    'durableIdempotentConversionMarkerDesignReviewed',
    'independentApprovalsForProductionDbMutation',
    'mainMergeAndFeatureReleaseApprovalAreSeparate',
    'noUnverifiedBadgeAwardsDuringProgressRecompute',
    'allPostcutoverPointLedgerBalancesReconciled'
  ];
  const missing = needed.filter((k) => prerequisiteChecks[k] !== true);
  return quote('cutover_preflight_plan_only', {
    original: freeze({
      ledgerRows: snapshot.ledgerRows,
      affectedUsers: snapshot.affectedUsers,
      ledgerPoints: snapshot.oldLedgerPoints,
      badgeDefinitionRows: snapshot.badgeDefinitionRows,
      badgePointsTotal: snapshot.badgeLegacyRewardSum,
      pointMetricBadgeCount: snapshot.pointMetricBadgeCount,
      pointMetricProgressRows: snapshot.pointMetricProgressRows,
      operatorAmountRows: snapshot.operatorAmountRows
    }),
    proposed: freeze({
      ledgerRows: snapshot.ledgerRows,
      affectedUsers: snapshot.affectedUsers,
      ledgerPoints: total.proposedValue,
      badgeDefinitionRows: snapshot.badgeDefinitionRows,
      badgePointsTotal: badgeTotal.proposedValue,
      pointMetricBadgeCount: snapshot.pointMetricBadgeCount,
      pointMetricProgressRows: snapshot.pointMetricProgressRows,
      exchangeMinimum: SCOUT_POINT_EXTERNAL_MINIMUM,
      yenFaceValue: SCOUT_POINT_INVOICE_YEN
    }),
    unresolvedEvidence: freeze(missing),
    checksToVerify: freeze([...needed]),
    doNotTouch: freeze([
      'scout_xp_ledger',
      'scout_level_thresholds',
      'story_pv',
      'scout_badge_metric_events',
      'scout_badge_metric_state_non_point'
    ]),
    requiresAtomicRealCutover: true,
    requiresSeparateSpecificProductionDbApproval: true,
    independentlyTestedOnLiveDatabase: false,
    automaticConversionAuthorized: false
  });
}
