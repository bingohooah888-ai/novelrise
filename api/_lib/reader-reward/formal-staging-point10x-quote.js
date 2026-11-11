// Offline-only proposal for verified beta Point users. No database client,
// mutation, Auth lookup, background job, or release permission is supplied.
// Future-only x10 migration 20261109173000 did NOT convert historical entries.
import {
  SCOUT_POINT_LEGACY_VERSION,
  quoteScoutPointTenfoldValue
} from './beta-point-tenfold-plan.js';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const FIELDS = [
  'ledgerRows',
  'ledgerUsers',
  'matchedAuthUsers',
  'unmatchedAuthUsers',
  'legacyBadgeRows',
  'legacyBadgeNet',
  'confirmedNet',
  'unsettledRows',
  'reversalRows',
  'negativeRows'
];
const uint = (x) => Number.isSafeInteger(x) && x >= 0;
const hold = (reason, extra = {}) =>
  Object.freeze({
    status: 'point10x_read_only_hold',
    reason,
    ...extra,
    mayWriteDb: false,
    maySkipUnmatchedUsers: false,
    mayCreateAuthUsers: false,
    mayIssuePoints: false,
    mayMergeMain: false
  });

/**
 * Calculate the historical badge-only x10 delta without changing existing
 * event IDs, user IDs, XP, future rewards, or badge definitions.
 * Aggregates are NOT evidence of identity provenance or a complete snapshot.
 */
export function quoteStagingHistoricalPoint10x({
  projectRef,
  sourceUnitVersion,
  snapshot
} = {}) {
  if (projectRef !== STAGING_REF) return hold('not_staging');
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    !FIELDS.every((key) => uint(snapshot[key]))
  )
    return hold('source_aggregate_missing_or_invalid');
  const s = snapshot;
  if (
    s.matchedAuthUsers + s.unmatchedAuthUsers !== s.ledgerUsers ||
    s.ledgerUsers > s.ledgerRows ||
    s.legacyBadgeRows > s.ledgerRows ||
    s.legacyBadgeNet > s.confirmedNet ||
    s.unsettledRows > s.ledgerRows ||
    s.reversalRows > s.ledgerRows ||
    s.negativeRows > s.ledgerRows
  )
    return hold('source_aggregate_inconsistent');
  if (sourceUnitVersion !== SCOUT_POINT_LEGACY_VERSION)
    return hold('historical_source_unit_unverified');
  const oldValue = quoteScoutPointTenfoldValue({
    legacyValue: s.legacyBadgeNet,
    sourceVersion: SCOUT_POINT_LEGACY_VERSION,
    field: 'ledger_point_value'
  });
  if (oldValue.status !== 'tenfold_value_quote_only')
    return hold('historical_tenfold_overflow');
  const delta = oldValue.proposedValue - s.legacyBadgeNet;
  const after = s.confirmedNet + delta;
  if (!uint(after)) return hold('historical_total_overflow');
  const proposed = Object.freeze({
    historicalRows: s.legacyBadgeRows,
    legacyBadgeNet: s.legacyBadgeNet,
    convertedBadgeNet: oldValue.proposedValue,
    delta,
    currentConfirmedNet: s.confirmedNet,
    proposedConfirmedNet: after,
    unchangedOtherPoints: s.confirmedNet - s.legacyBadgeNet,
    matchedAuthUsers: s.matchedAuthUsers,
    unresolvedAuthUsers: s.unmatchedAuthUsers,
    // These are quantities only: no identity whitelist or migration approval.
    identityWhitelistVerified: false,
    sourceSnapshotComplete: false
  });
  const blockers = [];
  if (s.unmatchedAuthUsers) blockers.push('ledger_user_identity_unresolved');
  if (s.unsettledRows || s.reversalRows || s.negativeRows)
    blockers.push('unsettled_reversal_or_negative_requires_policy');
  if (s.legacyBadgeRows !== s.ledgerRows)
    blockers.push('mixed_unit_rows_require_independent_classification');
  blockers.push('source_and_auth_provenance_not_attested');
  blockers.push('one_time_migration_owner_approval_missing');
  return Object.freeze({
    status: 'point10x_read_only_quote',
    projectRef,
    proposed,
    blockers: Object.freeze(blockers),
    mayWriteDb: false,
    maySkipUnmatchedUsers: false,
    mayCreateAuthUsers: false,
    mayIssuePoints: false,
    mayMergeMain: false
  });
}
