// Aggregate-only read of canonical beta Reader Badge and Scout Point ledgers.
// Does NOT grant missing rewards, relabel old units, or enable formal release.
// Existing baseline earned badges can legitimately lack a Point grant.
const BADGES_SQL =
  'select ' +
  "count(*) filter (where b.status='earned')::text as earned_badges, " +
  'count(*) filter (where p.id is not null)::text as linked_events, ' +
  "count(*) filter (where b.status='earned' and p.id is null and d.point_reward>0)::text as earned_without_event, " +
  "count(*) filter (where p.id is not null and p.status='confirmed' and p.point_kind='badge' and p.user_id=b.user_id and p.point_value=d.point_reward)::text as current_unit_events, " +
  "count(*) filter (where p.id is not null and p.status='confirmed' and p.point_kind='badge' and p.user_id=b.user_id and p.point_value*10=d.point_reward and p.point_value<>d.point_reward)::text as legacy_unit_events, " +
  "count(*) filter (where p.id is not null and (p.status<>'confirmed' or p.point_kind<>'badge' or p.user_id<>b.user_id or (p.point_value<>d.point_reward and p.point_value*10<>d.point_reward)))::text as anomalous_events, " +
  "count(*) filter (where p.id is not null and b.status<>'earned')::text as event_without_earned_status " +
  'from public.user_scout_badges b ' +
  'join public.scout_badge_definitions d on d.badge_id=b.badge_id ' +
  "left join public.scout_point_ledger p on p.event_key=('badge:' || b.user_id::text || ':' || b.badge_id) " +
  "where d.badge_category='reader'";

const ORPHANS_SQL =
  'select ' +
  "count(*) filter (where p.metadata->>'badge_id' is null)::text as unclassified_badge_events, " +
  "count(*) filter (where (d.badge_category='reader' or p.metadata->>'badge_id' like 'reader_%') and (b.badge_id is null or p.event_key<>('badge:' || p.user_id::text || ':' || b.badge_id)))::text as orphan_reader_badge_events " +
  'from public.scout_point_ledger p ' +
  "left join public.scout_badge_definitions d on d.badge_id=(p.metadata->>'badge_id') " +
  "left join public.user_scout_badges b on b.user_id=p.user_id and b.badge_id=(p.metadata->>'badge_id') " +
  "where p.point_kind='badge'";

function nonnegative(value) {
  const number =
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('FORMAL_BADGE_HISTORY_COUNT_INVALID');
  return number;
}

function counts(result, keys) {
  if (!Array.isArray(result?.rows) || result.rows.length !== 1)
    throw new Error('FORMAL_BADGE_HISTORY_AGGREGATE_UNAVAILABLE');
  const row = result.rows[0];
  return Object.fromEntries(keys.map((key) => [key, nonnegative(row?.[key])]));
}

export function createUnregisteredFormalBadgeHistoryInspector({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted read-only PostgreSQL query required');
  return Object.freeze({
    async inspect() {
      // Never return any user IDs, badge event keys, or individual amounts.
      const [badgeRows, pointRows] = await Promise.all([
        query(BADGES_SQL),
        query(ORPHANS_SQL)
      ]);
      const badges = counts(badgeRows, [
        'earned_badges',
        'linked_events',
        'earned_without_event',
        'current_unit_events',
        'legacy_unit_events',
        'anomalous_events',
        'event_without_earned_status'
      ]);
      const point = counts(pointRows, [
        'unclassified_badge_events',
        'orphan_reader_badge_events'
      ]);
      const classified =
        badges.current_unit_events +
        badges.legacy_unit_events +
        badges.anomalous_events;
      if (
        !Number.isSafeInteger(classified) ||
        classified !== badges.linked_events ||
        badges.event_without_earned_status > badges.linked_events ||
        badges.earned_without_event > badges.earned_badges
      )
        throw new Error('FORMAL_BADGE_HISTORY_AGGREGATE_INCONSISTENT');
      const blockers = ['beta_point_10x_cutover_not_verified'];
      if (badges.legacy_unit_events)
        blockers.push('legacy_badge_point_units_require_reconciliation');
      if (badges.earned_without_event)
        blockers.push('earned_without_point_event_requires_manual_review');
      if (badges.anomalous_events || badges.event_without_earned_status)
        blockers.push('badge_event_state_mismatch_requires_review');
      if (point.orphan_reader_badge_events || point.unclassified_badge_events)
        blockers.push('unmatched_badge_point_events_require_review');
      // Catalog definitions, whole-ledger conversion and independent cohort
      // verification are separate. This audit cannot authorize a migration.
      blockers.push('complete_point_ledger_and_wallet_cohort_review_required');
      return Object.freeze({
        status: 'formal_badge_history_review_only',
        observed: Object.freeze({ ...badges, ...point }),
        blockers: Object.freeze(blockers),
        // A baseline badge can be marked earned without a cash-equivalent
        // grant. This is a review count, NOT a new payout obligation.
        historicalMissingPointsMayBeBackfilled: false,
        historyFullyReconciled: false,
        betaPointTenfoldMigrationVerified: false,
        readyForPublicRelease: false,
        mayWriteDb: false,
        mayIssuePoints: false,
        mayChangeBadges: false
      });
    }
  });
}
