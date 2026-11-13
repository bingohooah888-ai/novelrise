// Gate 14 / beta Point x10: read-only Staging evidence, never a DB executor.
// Real Supabase Staging must be separately approved by OWNER for exact scope.
const PRODUCTION_PROJECT = 'fiepaguycecrredwrcwx';
const STAGING_BRANCH_PROJECT = 'wmlzjgvxgoyrovdhbqbg';
export const SCOUT_TENFOLD_STAGING_SURFACES = Object.freeze([
  'scout_point_ledger.point_value',
  'scout_badge_definitions.point_reward',
  'scout_badge_definitions.target_value[scout_point_earned_total]',
  'user_scout_badges.progress_value[reader_point_100,reader_point_500]',
  'scout_point_operator_actions.amount',
  'novelight_award_level_up_points()',
  'novelight_apply_scout_badge_evaluation()',
  'novelight_reader_badge_metrics()',
  'novelight_scout_record_summary()',
  'novelight_scout_point_history()',
  'novelight_refresh_scout_badges_for_user()'
]);
const int = (value) => Number.isSafeInteger(value);
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const freeze = (v) => Object.freeze(v);
const result = (status, extra = {}) =>
  freeze({
    status,
    ...extra,
    stagingWriteAllowed: false,
    productionWriteAllowed: false,
    mayExecuteSql: false,
    maySettle: false,
    mayRunAI: false,
    mayMergeMain: false,
    evidenceIsReadOnly: true
  });
const required = [
  'ledgerRows',
  'ledgerUsers',
  'ledgerSum',
  'distinctEventKeys',
  'badgeDefinitionRows',
  'badgeRewardSum',
  'pointBadgeCount',
  'pointProgressRows',
  'pointProgressSum',
  'pointEarnedRows',
  'operatorAmountRows',
  'operatorAmountSum',
  'nonconfirmedLedgerRows',
  'reversalRows',
  'pointOverflowRows',
  'badgeRewardOverflowRows',
  'progressOverflowRows'
];
function snapshot(value) {
  if (!obj(value)) throw new TypeError('Aggregate snapshot object is required');
  for (const key of required) {
    if (!int(value[key]))
      throw new TypeError('Aggregate integer required: ' + key);
  }
  const nonnegative = required.filter(
    (k) => !['ledgerSum', 'pointProgressSum', 'operatorAmountSum'].includes(k)
  );
  if (nonnegative.some((k) => value[k] < 0)) {
    throw new RangeError('Negative count or violation field not allowed');
  }
  if (
    value.ledgerUsers > value.ledgerRows ||
    value.distinctEventKeys > value.ledgerRows ||
    value.pointEarnedRows > value.pointProgressRows ||
    value.nonconfirmedLedgerRows > value.ledgerRows ||
    value.reversalRows > value.ledgerRows
  ) {
    throw new RangeError('Inconsistent source snapshot counts');
  }
  return value;
}
function timesTen(n) {
  if (!int(n) || !int(n * 10)) return null;
  return n * 10;
}
/**
 * Survey only; counts are supplied by a separate read-only catalog query.
 * No data-bound preflight can override OWNER Staging approval requirements.
 */
export function quoteScoutTenfoldStagingShadow({
  productionRef,
  stagingRef,
  production,
  staging,
  sameTableAndFunctionShape = false,
  sameFunctionAndTriggerDigests = false
}) {
  if (
    productionRef !== PRODUCTION_PROJECT ||
    stagingRef !== STAGING_BRANCH_PROJECT ||
    productionRef === stagingRef
  ) {
    return result('project_identity_not_staging_or_production_hold');
  }
  const prod = snapshot(production);
  const st = snapshot(staging);
  const failures = [];
  if (st.distinctEventKeys !== st.ledgerRows)
    failures.push('duplicate_event_keys');
  if (st.pointOverflowRows > 0) failures.push('point_constraint_overflow');
  if (st.badgeRewardOverflowRows > 0) failures.push('badge_reward_overflow');
  if (st.progressOverflowRows > 0)
    failures.push('point_badge_progress_overflow');
  if (timesTen(st.ledgerSum) === null)
    failures.push('aggregate_ledger_overflow');
  if (timesTen(st.badgeRewardSum) === null)
    failures.push('aggregate_badge_overflow');
  if (timesTen(st.pointProgressSum) === null)
    failures.push('aggregate_progress_overflow');
  if (!sameTableAndFunctionShape) failures.push('schema_signature_unverified');
  if (!sameFunctionAndTriggerDigests)
    failures.push('function_or_trigger_drift');
  const projection = freeze({
    ledgerRows: st.ledgerRows,
    ledgerUsers: st.ledgerUsers,
    ledgerSum: timesTen(st.ledgerSum),
    badgeDefinitionRows: st.badgeDefinitionRows,
    badgeRewardSum: timesTen(st.badgeRewardSum),
    pointBadgeCount: st.pointBadgeCount,
    pointProgressRows: st.pointProgressRows,
    pointProgressSum: timesTen(st.pointProgressSum),
    pointEarnedRows: st.pointEarnedRows,
    operatorAmountRows: st.operatorAmountRows,
    operatorAmountSum: timesTen(st.operatorAmountSum)
  });
  return result(
    failures.length
      ? 'read_only_shadow_unverified_hold'
      : 'read_only_shadow_pass_only',
    {
      baseIsSeparateFromProduction: true,
      stagingDataMatchesProduction:
        st.ledgerRows === prod.ledgerRows &&
        st.ledgerSum === prod.ledgerSum &&
        st.ledgerUsers === prod.ledgerUsers,
      stagingIsNotAProductionDataBackup: true,
      observed: freeze({ ...st }),
      productionAggregate: freeze({ ...prod }),
      projected: projection,
      blockers: freeze(failures),
      requiresAtomicStagingCutoverProof: true,
      requiresFullBackupAndRestoreProof: true,
      requiresOwnerStagingApproval: true,
      approvalScope: 'reader-reward-beta-point-10x-staging',
      evidenceCannotGrantApproval: true,
      signedCurrentMainApprovalVerified: false
    }
  );
}

/**
 * Compare before/after aggregates and caller-supplied immutable ID/status
 * digests. It does not prove complete snapshot freshness, function update
 * atomicity, concurrency safety, or a durable rollback.
 */
export function verifyScoutTenfoldReconciliation({ before, after }) {
  const a = snapshot(before);
  const b = snapshot(after);
  const immutableFields = [
    'ledgerRows',
    'ledgerUsers',
    'distinctEventKeys',
    'badgeDefinitionRows',
    'pointBadgeCount',
    'pointProgressRows',
    'pointEarnedRows',
    'nonconfirmedLedgerRows',
    'reversalRows'
  ];
  const scaledFields = [
    'ledgerSum',
    'badgeRewardSum',
    'pointProgressSum',
    'operatorAmountSum'
  ];
  const mismatches = [];
  for (const k of immutableFields) {
    if (a[k] !== b[k]) mismatches.push('immutable_' + k);
  }
  for (const k of scaledFields) {
    if (b[k] !== timesTen(a[k])) mismatches.push('tenfold_' + k);
  }
  if (b.distinctEventKeys !== b.ledgerRows)
    mismatches.push('event_key_uniqueness');
  for (const k of [
    'pointOverflowRows',
    'badgeRewardOverflowRows',
    'progressOverflowRows'
  ]) {
    if (b[k] !== 0) mismatches.push(k);
  }
  for (const k of [
    'ledgerIdsDigest',
    'ledgerEventKeysDigest',
    'ledgerStatusesDigest',
    'ledgerUsersDigest',
    'sourceReferencesDigest',
    'earnedBadgesDigest',
    'nonPointProgressDigest',
    'xpAndRankDigest',
    'badgePercentageDigest'
  ]) {
    if (
      typeof a[k] !== 'string' ||
      !a[k] ||
      typeof b[k] !== 'string' ||
      b[k] !== a[k]
    )
      mismatches.push('digest_' + k);
  }
  return result(
    mismatches.length
      ? 'postcutover_reconciliation_hold'
      : 'untrusted_snapshot_reconciliation_only',
    {
      mismatches: freeze(mismatches),
      independentlyVerifiedDbTransaction: false,
      independentCompleteBackupVerified: false,
      mayReleaseStaging: false
    }
  );
}

export function quoteScoutTenfoldRollbackEquality({
  before,
  afterRollback,
  restoreBackupVerified = false,
  noNewWritesAfterSnapshot = false,
  markerStateRestoredVerified = false,
  levelUpFunctionRestoredVerified = false
}) {
  const a = snapshot(before);
  const b = snapshot(afterRollback);
  const different = Object.keys(a).filter((key) => b[key] !== a[key]);
  for (const k of [
    'ledgerIdsDigest',
    'ledgerEventKeysDigest',
    'ledgerStatusesDigest',
    'ledgerUsersDigest',
    'sourceReferencesDigest',
    'earnedBadgesDigest',
    'nonPointProgressDigest',
    'xpAndRankDigest',
    'badgePercentageDigest'
  ]) {
    if (!a[k] || b[k] !== a[k]) different.push('digest_' + k);
  }
  const missing = [];
  if (restoreBackupVerified !== true) missing.push('independent_restore_proof');
  if (noNewWritesAfterSnapshot !== true)
    missing.push('cutover_exclusive_window');
  if (markerStateRestoredVerified !== true)
    missing.push('durable_marker_restoration');
  if (levelUpFunctionRestoredVerified !== true)
    missing.push('award_function_restoration');
  return result(
    different.length || missing.length
      ? 'rollback_unverified_hold'
      : 'untrusted_rollback_snapshot_equal_only',
    {
      changedFields: freeze(different),
      outstandingProof: freeze(missing),
      actualSupabaseRestoreVerified: false,
      requiresSeparateOwnerApproval: true
    }
  );
}
