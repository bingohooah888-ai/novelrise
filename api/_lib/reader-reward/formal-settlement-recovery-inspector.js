// OWNER-held formal Point channels: aggregate-only settlement/recovery review.
// Never retries a payout, releases a reservation, refunds or resumes writers.
// All state/event/ledger comparisons execute inside ONE read-only SELECT.
const SQL = `
with histories as (
  select
    o.operation_id,
    count(e.event_id) filter (where e.phase = 'reserved') as reserve_events,
    count(e.event_id) filter (where e.phase = 'committed') as commit_events,
    count(e.event_id) filter (where e.phase = 'released') as release_events,
    count(e.event_id) filter (where e.phase = 'refunded') as refund_events,
    count(e.event_id) filter (
      where e.user_id is distinct from o.user_id
         or e.purpose is distinct from o.purpose
         or e.amount_points is distinct from o.amount_points
         or e.feature_id is distinct from o.feature_id
    ) as unbound_events
  from novelight_formal_private.scout_point_usage_operations o
  left join novelight_formal_private.scout_point_usage_events e
    on e.operation_id = o.operation_id
  group by o.operation_id
), settlements as (
  select
    o.operation_id,
    o.user_id,
    o.purpose,
    o.phase,
    o.amount_points,
    h.reserve_events,
    h.commit_events,
    h.release_events,
    h.refund_events,
    h.unbound_events,
    s.id as spend_id,
    s.user_id as spend_user_id,
    s.point_kind as spend_kind,
    s.point_value as spend_value,
    s.status as spend_status,
    s.reversal_of as spend_reversal,
    f.id as refund_id,
    f.user_id as refund_user_id,
    f.point_kind as refund_kind,
    f.point_value as refund_value,
    f.status as refund_status,
    f.reversal_of as refund_reversal
  from novelight_formal_private.scout_point_usage_operations o
  join histories h on h.operation_id = o.operation_id
  left join public.scout_point_ledger s
    on s.event_key = ('scout-formal-spend:' || o.operation_id::text)
  left join public.scout_point_ledger f
    on f.event_key = ('scout-formal-refund:' || o.operation_id::text)
), checked as (
  select
    *,
    (
      reserve_events <> 1
      or unbound_events <> 0
      or (case when phase in ('committed','refunded')
        then commit_events <> 1 else commit_events <> 0 end)
      or (case when phase = 'released'
        then release_events <> 1 else release_events <> 0 end)
      or (case when phase = 'refunded'
        then refund_events <> 1 else refund_events <> 0 end)
    ) as history_mismatch,
    (
      spend_id is not null and (
        spend_user_id is distinct from user_id
        or spend_status is distinct from 'confirmed'
        or spend_kind is distinct from
          (case when purpose = 'ai_direct_use'
            then 'formal_ai_spend' else 'formal_external_exchange' end)
        or spend_value is distinct from -amount_points
        or spend_reversal is not null
      )
    ) as invalid_spend,
    (
      refund_id is not null and (
        refund_user_id is distinct from user_id
        or refund_status is distinct from 'confirmed'
        or refund_kind is distinct from
          (case when purpose = 'ai_direct_use'
            then 'formal_ai_refund'
            else 'formal_external_exchange_refund' end)
        or refund_value is distinct from amount_points
        or refund_reversal is distinct from spend_id
      )
    ) as invalid_refund
  from settlements
), orphaned as (
  select count(*) as orphan_count
  from public.scout_point_ledger p
  left join novelight_formal_private.scout_point_usage_operations o
    on p.event_key = ('scout-formal-spend:' || o.operation_id::text)
    or p.event_key = ('scout-formal-refund:' || o.operation_id::text)
  where (
    p.point_kind in (
      'formal_ai_spend','formal_external_exchange',
      'formal_ai_refund','formal_external_exchange_refund'
    )
    or p.event_key like 'scout-formal-spend:%'
    or p.event_key like 'scout-formal-refund:%'
  ) and o.operation_id is null
)
select
  count(*)::text as operations_total,
  count(*) filter (where c.phase = 'reserved')::text as reserved_operations,
  count(*) filter (where c.phase = 'committed')::text as committed_operations,
  count(*) filter (where c.phase = 'released')::text as released_operations,
  count(*) filter (where c.phase = 'refunded')::text as refunded_operations,
  count(*) filter (where c.history_mismatch)::text as history_mismatch_operations,
  count(*) filter (
    where c.phase in ('committed','refunded') and c.spend_id is null
  )::text as missing_spend_operations,
  count(*) filter (
    where c.phase in ('reserved','released') and c.spend_id is not null
  )::text as unexpected_spend_operations,
  count(*) filter (where c.invalid_spend)::text as invalid_spend_operations,
  count(*) filter (
    where c.phase = 'refunded' and c.refund_id is null
  )::text as missing_refund_operations,
  count(*) filter (
    where c.phase <> 'refunded' and c.refund_id is not null
  )::text as unexpected_refund_operations,
  count(*) filter (where c.invalid_refund)::text as invalid_refund_operations,
  coalesce(max(o.orphan_count), 0)::text as orphan_settlement_ledger_events
from checked c cross join orphaned o
`;

const FIELDS = Object.freeze([
  'operations_total',
  'reserved_operations',
  'committed_operations',
  'released_operations',
  'refunded_operations',
  'history_mismatch_operations',
  'missing_spend_operations',
  'unexpected_spend_operations',
  'invalid_spend_operations',
  'missing_refund_operations',
  'unexpected_refund_operations',
  'invalid_refund_operations',
  'orphan_settlement_ledger_events'
]);

function positiveInt(value) {
  const number =
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('FORMAL_SETTLEMENT_RECOVERY_INVALID_AGGREGATE');
  return number;
}

export function createUnregisteredFormalSettlementRecoveryInspector({
  query
} = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted read-only PostgreSQL query required');
  return Object.freeze({
    async inspect() {
      const response = await query(SQL);
      if (!Array.isArray(response?.rows) || response.rows.length !== 1)
        throw new Error('FORMAL_SETTLEMENT_RECOVERY_UNAVAILABLE');
      const observed = Object.fromEntries(
        FIELDS.map((field) => [field, positiveInt(response.rows[0]?.[field])])
      );
      const totalPhases =
        observed.reserved_operations +
        observed.committed_operations +
        observed.released_operations +
        observed.refunded_operations;
      if (
        !Number.isSafeInteger(totalPhases) ||
        totalPhases !== observed.operations_total ||
        FIELDS.slice(5, -1).some(
          (field) => observed[field] > observed.operations_total
        )
      )
        throw new Error('FORMAL_SETTLEMENT_RECOVERY_INCONSISTENT');

      const blockers = [];
      if (observed.history_mismatch_operations)
        blockers.push('operation_transition_history_requires_review');
      if (
        observed.missing_spend_operations ||
        observed.unexpected_spend_operations ||
        observed.invalid_spend_operations
      )
        blockers.push('committed_debit_or_phase_mismatch_requires_review');
      if (
        observed.missing_refund_operations ||
        observed.unexpected_refund_operations ||
        observed.invalid_refund_operations
      )
        blockers.push('refund_provenance_or_phase_mismatch_requires_review');
      if (observed.orphan_settlement_ledger_events)
        blockers.push('unbound_settlement_ledger_events_require_review');
      if (observed.reserved_operations)
        blockers.push('pending_reservations_require_individual_review');
      // An internally consistent synthetic/aggregate report is never a
      // provider fulfillment attestation, recovery mandate or release gate.
      blockers.push('provider_fulfillment_and_refund_finality_unverified');
      blockers.push('wallet_budget_canonical_ledger_census_required');
      blockers.push('owner_approval_required_for_any_recovery_or_release');
      return Object.freeze({
        status: 'formal_settlement_recovery_review_only',
        observed: Object.freeze(observed),
        blockers: Object.freeze(blockers),
        actualProviderOutcomeVerified: false,
        historicOperationsRecovered: false,
        readyForPublicRelease: false,
        mayResumeWriters: false,
        mayWriteDb: false,
        maySettle: false,
        mayRefund: false,
        mayIssuePoints: false,
        maySpendPoints: false,
        mayEnableGift: false,
        mayEnableAi: false
      });
    }
  });
}
