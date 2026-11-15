// Non-public, aggregate-only reconciliation of existing Scout Point ledger
// and private formal Wallet mirrors. No migration, account list or Point writes.
// A clean report cannot prove beta unit provenance or authorize release.
const SQL = `
with ledger as (
  select
    user_id,
    coalesce(sum(point_value) filter (where status = 'confirmed'), 0)::numeric as confirmed_points,
    count(*) filter (where status <> 'confirmed') as unsettled_rows
  from public.scout_point_ledger
  group by user_id
), cohort as (
  select
    w.user_id is not null as has_wallet,
    l.user_id is not null as has_ledger,
    coalesce(l.confirmed_points, 0)::numeric as confirmed_points,
    coalesce(l.unsettled_rows, 0)::numeric as unsettled_rows,
    coalesce(w.available_points, 0)::numeric as available_points,
    coalesce(w.reserved_points, 0)::numeric as reserved_points,
    coalesce(w.exchange_eligible_points, 0)::numeric as eligible_points,
    coalesce(w.held_points, 0)::numeric as held_points
  from novelight_formal_private.scout_point_usage_wallets w
  full outer join ledger l on l.user_id = w.user_id
)
select
  count(*)::text as population_users,
  count(*) filter (where has_wallet)::text as wallet_users,
  count(*) filter (where has_ledger)::text as ledger_users,
  count(*) filter (where not has_wallet and has_ledger)::text as ledger_without_wallet_users,
  count(*) filter (where has_wallet and not has_ledger)::text as wallet_without_ledger_users,
  count(*) filter (where has_wallet and available_points + reserved_points <> confirmed_points)::text as wallet_balance_mismatch_users,
  count(*) filter (where has_wallet and eligible_points > available_points)::text as eligible_exceeds_available_users,
  count(*) filter (where has_ledger and confirmed_points < 0)::text as negative_ledger_users,
  count(*) filter (where unsettled_rows > 0)::text as unsettled_ledger_users,
  coalesce(sum(unsettled_rows), 0)::text as unsettled_ledger_rows,
  count(*) filter (where has_wallet and held_points > 0)::text as held_wallet_users,
  coalesce(sum(available_points), 0)::text as wallet_available_points,
  coalesce(sum(reserved_points), 0)::text as wallet_reserved_points,
  coalesce(sum(eligible_points), 0)::text as wallet_eligible_points,
  coalesce(sum(confirmed_points), 0)::text as ledger_confirmed_net_points
from cohort
`;

const COUNT_FIELDS = Object.freeze([
  'population_users',
  'wallet_users',
  'ledger_users',
  'ledger_without_wallet_users',
  'wallet_without_ledger_users',
  'wallet_balance_mismatch_users',
  'eligible_exceeds_available_users',
  'negative_ledger_users',
  'unsettled_ledger_users',
  'unsettled_ledger_rows',
  'held_wallet_users'
]);
const POINT_FIELDS = Object.freeze([
  'wallet_available_points',
  'wallet_reserved_points',
  'wallet_eligible_points',
  'ledger_confirmed_net_points'
]);

function integer(value, allowNegative = false) {
  const number =
    typeof value === 'string' && /^-?\d+$/.test(value)
      ? Number(value)
      : value;
  if (
    !Number.isSafeInteger(number) ||
    (!allowNegative && number < 0)
  )
    throw new Error('FORMAL_WALLET_COHORT_INVALID_AGGREGATE');
  return number;
}

export function createUnregisteredFormalWalletCohortInspector({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted read-only PostgreSQL query required');
  return Object.freeze({
    async inspect() {
      // One SELECT provides one statement-level snapshot; no user IDs leave DB.
      const response = await query(SQL);
      if (!Array.isArray(response?.rows) || response.rows.length !== 1)
        throw new Error('FORMAL_WALLET_COHORT_UNAVAILABLE');
      const row = response.rows[0];
      const values = {};
      for (const field of COUNT_FIELDS) values[field] = integer(row?.[field]);
      for (const field of POINT_FIELDS) {
        values[field] = integer(
          row?.[field],
          field === 'ledger_confirmed_net_points'
        );
      }
      if (
        values.wallet_users > values.population_users ||
        values.ledger_users > values.population_users ||
        values.ledger_without_wallet_users > values.ledger_users ||
        values.wallet_without_ledger_users > values.wallet_users ||
        values.wallet_balance_mismatch_users > values.wallet_users ||
        values.eligible_exceeds_available_users > values.wallet_users ||
        values.negative_ledger_users > values.ledger_users ||
        values.unsettled_ledger_users > values.ledger_users ||
        values.held_wallet_users > values.wallet_users ||
        values.unsettled_ledger_rows < values.unsettled_ledger_users ||
        values.wallet_users + values.ledger_without_wallet_users !==
          values.population_users ||
        values.ledger_users + values.wallet_without_ledger_users !==
          values.population_users ||
        values.wallet_eligible_points > values.wallet_available_points ||
        !Number.isSafeInteger(
          values.wallet_available_points + values.wallet_reserved_points
        )
      )
        throw new Error('FORMAL_WALLET_COHORT_INCONSISTENT');
      const blockers = [];
      if (values.ledger_without_wallet_users)
        blockers.push('canonical_ledger_users_without_wallet');
      if (values.wallet_balance_mismatch_users)
        blockers.push('wallet_and_confirmed_ledger_balance_mismatch');
      if (values.eligible_exceeds_available_users)
        blockers.push('exchange_eligible_balance_invariant_violation');
      if (values.negative_ledger_users)
        blockers.push('negative_canonical_ledger_balance');
      if (values.unsettled_ledger_rows)
        blockers.push('unsettled_canonical_point_rows_require_review');
      if (values.held_wallet_users)
        blockers.push('wallet_holds_require_separate_review');
      // A matching amount does not demonstrate the provenance of beta
      // Point, or that the exchange-eligible subset excludes all beta Point.
      blockers.push('beta_point_per_event_unit_provenance_unverified');
      blockers.push('exchange_eligible_origin_not_independently_verified');
      blockers.push('formal_wallet_staging_and_release_approval_pending');
      return Object.freeze({
        status: 'formal_wallet_cohort_review_only',
        observed: Object.freeze(values),
        blockers: Object.freeze(blockers),
        wholeCohortLedgerMatchesVerified: false,
        betaPointTenfoldMigrationVerified: false,
        giftEligibilitySourceVerified: false,
        readyForPublicRelease: false,
        mayWriteDb: false,
        mayIssuePoints: false,
        maySpendPoints: false,
        mayEnableGift: false,
        mayEnableAi: false
      });
    }
  });
}
