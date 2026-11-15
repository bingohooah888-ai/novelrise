// Read-only formal Reader Badge catalog review for a trusted administrator.
// Never enables badges, replays XP, converts Point units or writes a ledger.
// Existing beta catalogue remains the only source of truth.
const SQL =
  'select badge_id,difficulty,sort_order,enabled,point_reward ' +
  'from public.scout_badge_definitions ' +
  "where badge_category='reader' " +
  'order by sort_order,badge_id limit 101';

export const FORMAL_READER_BADGE_CATALOG = Object.freeze({
  total: 100,
  easy: 30,
  normal: 50,
  hard: 20,
  theoreticalPointReward: 8350
});

function integer(value, min, max) {
  const n =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error('FORMAL_BADGE_CATALOG_INVALID_NUMBER');
  return n;
}

export function createUnregisteredFormalBadgeCatalogInspector({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted read-only PostgreSQL query required');
  return Object.freeze({
    async inspect() {
      const result = await query(SQL);
      if (!Array.isArray(result?.rows) || result.rows.length > 101)
        throw new Error('FORMAL_BADGE_CATALOG_UNAVAILABLE');
      const counts = { easy: 0, normal: 0, hard: 0 };
      const enabledCounts = { easy: 0, normal: 0, hard: 0 };
      const ids = new Set();
      const order = new Set();
      let totalReward = 0;
      for (const row of result.rows) {
        if (
          !row ||
          typeof row.badge_id !== 'string' ||
          !/^reader_[a-z0-9_]+$/.test(row.badge_id) ||
          ids.has(row.badge_id) ||
          !Object.hasOwn(counts, row.difficulty) ||
          typeof row.enabled !== 'boolean'
        )
          throw new Error('FORMAL_BADGE_CATALOG_IDENTITY_INVALID');
        const position = integer(row.sort_order, 1, 1000);
        const reward = integer(row.point_reward, 0, 1000000);
        if (order.has(position))
          throw new Error('FORMAL_BADGE_CATALOG_ORDER_DUPLICATE');
        ids.add(row.badge_id);
        order.add(position);
        counts[row.difficulty]++;
        if (row.enabled) enabledCounts[row.difficulty]++;
        totalReward += reward;
        if (!Number.isSafeInteger(totalReward))
          throw new Error('FORMAL_BADGE_CATALOG_POINT_OVERFLOW');
      }
      const expected = FORMAL_READER_BADGE_CATALOG;
      const blockers = [];
      if (ids.size !== expected.total)
        blockers.push('reader_badge_count_mismatch');
      if (
        counts.easy !== expected.easy ||
        counts.normal !== expected.normal ||
        counts.hard !== expected.hard
      )
        blockers.push('reader_badge_difficulty_mismatch');
      if (
        order.size !== expected.total ||
        [...order].some((position) => position > expected.total)
      )
        blockers.push('reader_badge_sort_order_mismatch');
      if (totalReward !== expected.theoreticalPointReward)
        blockers.push('reader_badge_point_unit_or_reward_mismatch');
      const activeCount =
        enabledCounts.easy + enabledCounts.normal + enabledCounts.hard;
      if (activeCount !== expected.total)
        blockers.push('reader_badge_release_gates_not_enabled');
      // Existing beta awards and their canonical Point event keys are NOT
      // independently reconciled by a definition-only SELECT.
      blockers.push('badge_history_and_10x_ledger_reconciliation_required');
      return Object.freeze({
        status: 'formal_badge_catalog_review_only',
        expected,
        observed: Object.freeze({
          total: ids.size,
          easy: counts.easy,
          normal: counts.normal,
          hard: counts.hard,
          enabled: activeCount,
          theoreticalPointReward: totalReward
        }),
        blockers: Object.freeze(blockers),
        betaPointTenfoldMigrationVerified: false,
        historicBadgeAwardsReconciled: false,
        readyForPublicRelease: false,
        mayEnableBadges: false,
        mayIssuePoints: false,
        mayWriteDb: false
      });
    }
  });
}
