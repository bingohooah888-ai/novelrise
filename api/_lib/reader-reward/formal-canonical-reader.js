// Future-only canonical Scout ledger / formal Level read adapters.
// Uses the existing public.scout_point_ledger and public.scout_xp_ledger
// through a trusted, server-injected PostgreSQL executor (not browser REST).
// Never creates a connection, migrates units, adjusts XP, or credits Point.
import {
  FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30,
  FORMAL_SCOUT_MAX_LEVEL
} from './formal-thresholds.js';
import { SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS } from './rates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_UNIT = 'beta_ten_points_per_yen';
const REVIEW_MS = 30 * 86400000;
const valid = (v) => typeof v === 'string' && UUID.test(v);
function integer(value, label, min = 0) {
  const n =
    typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min)
    throw new TypeError('Invalid authoritative ' + label);
  return n;
}
function iso(value) {
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new TypeError('Valid trusted timestamp required');
  return new Date(value).toISOString();
}
function verifiedService(verification) {
  return (
    verification?.unitVersion === ALLOWED_UNIT &&
    verification?.cutoverVerifiedByTrustedServer === true &&
    verification?.canonicalLedgerReconciled === true &&
    typeof verification?.formalReleaseAt === 'string' &&
    Number.isFinite(Date.parse(verification.formalReleaseAt))
  );
}

export function createFormalCanonicalReader({
  query,
  unitVerification,
  now = () => Date.now()
} = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Injected private server query required');
  if (typeof now !== 'function')
    throw new TypeError('Injected server clock required');
  const allowed = () => verifiedService(unitVerification);
  function assertReady() {
    if (!allowed()) throw new Error('FORMAL_CANONICAL_UNIT_CUTOVER_UNVERIFIED');
  }
  async function readCanonicalBalance(userId, executor = query) {
    if (!valid(userId)) throw new TypeError('Verified user ID required');
    assertReady();
    const data = await executor(
      'select coalesce(sum(point_value),0)::text as confirmed_points ' +
        'from public.scout_point_ledger where user_id=$1::uuid and status=$2::text',
      [userId, 'confirmed']
    );
    if (!data?.rows || data.rows.length !== 1)
      throw new Error('FORMAL_CANONICAL_POINT_BALANCE_UNAVAILABLE');
    return integer(data.rows[0].confirmed_points, 'confirmed Point balance');
  }
  async function assertWalletCoherent(userId, wallet, executor = query) {
    if (!wallet || wallet.userId !== userId)
      throw new Error('FORMAL_CANONICAL_WALLET_OWNER_MISMATCH');
    const expected =
      integer(wallet.availablePoints, 'wallet available') +
      integer(wallet.reservedPoints, 'wallet held');
    if (!Number.isSafeInteger(expected))
      throw new RangeError('FORMAL_CANONICAL_POINT_SUM_OVERFLOW');
    const observed = await readCanonicalBalance(userId, executor);
    if (expected !== observed)
      throw new Error('FORMAL_CANONICAL_POINT_MIRROR_OUT_OF_SYNC');
    // In particular, a newly issued Point must be mirrored in the same
    // formal earnings transaction before this wallet permits spending.
    return Object.freeze({ status: 'coherent', confirmedPoints: observed });
  }
  async function readFormalAccount(userId) {
    if (!valid(userId)) throw new TypeError('Verified user ID required');
    assertReady();
    const result = await query(
      'select user_id,current_level,highest_level,level_progress_xp,' +
        'review_anchor_at,last_review_end_at,revision ' +
        'from novelight_formal_private.scout_level_state where user_id=$1::uuid',
      [userId]
    );
    const row = result?.rows?.[0];
    if (!row || row.user_id !== userId)
      throw new Error('FORMAL_LEVEL_STATE_UNINITIALIZED');
    const level = integer(row.current_level, 'current Level', 1);
    const peak = integer(row.highest_level, 'highest Level', 1);
    const progressXp = integer(row.level_progress_xp, 'Level progress');
    if (
      level > FORMAL_SCOUT_MAX_LEVEL ||
      peak > FORMAL_SCOUT_MAX_LEVEL ||
      peak < level
    )
      throw new Error('FORMAL_LEVEL_STATE_INVALID');
    const anchor = Date.parse(iso(row.review_anchor_at));
    const last = row.last_review_end_at
      ? Date.parse(iso(row.last_review_end_at))
      : null;
    const start = last ?? anchor;
    const end = start + REVIEW_MS;
    const currentTime = now();
    if (
      !Number.isSafeInteger(currentTime) ||
      currentTime < 0 ||
      start > currentTime ||
      end <= start ||
      (last !== null &&
        (last - anchor < REVIEW_MS || (last - anchor) % REVIEW_MS !== 0))
    )
      throw new Error('FORMAL_LEVEL_WINDOW_INVALID');
    const threshold =
      level >= 30
        ? FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30
        : await readBetaLevelThreshold(level);
    // If a maintenance checkpoint is overdue, the authoritative review must
    // run first; do not display current state as current/reviewed.
    if (currentTime >= end) throw new Error('FORMAL_LEVEL_REVIEW_DUE');
    const xpRows = await query(
      'select coalesce(sum(xp_value),0)::text as earned_xp,' +
        'count(*) filter (where xp_value < 0)::bigint as negative_rows ' +
        'from public.scout_xp_ledger where user_id=$1::uuid and ' +
        'occurred_at >= $2::timestamptz and occurred_at < $3::timestamptz',
      [
        userId,
        new Date(start).toISOString(),
        new Date(currentTime).toISOString()
      ]
    );
    const summary = xpRows?.rows?.[0];
    if (!summary) throw new Error('FORMAL_XP_WINDOW_UNAVAILABLE');
    if (integer(summary.negative_rows, 'signed XP rows') > 0)
      throw new Error('FORMAL_XP_ADJUSTMENT_REVIEW_PENDING');
    const earnedXpInPeriod = integer(summary.earned_xp, '30-day credited XP');
    if (level < 100 && progressXp >= threshold)
      throw new Error('FORMAL_LEVEL_PROGRESS_INVALID');
    return Object.freeze({
      level,
      highestLevel: peak,
      progressXp,
      requiredXp: level === 100 ? null : threshold,
      earnedXpInPeriod,
      maintenanceXpTarget: SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS,
      nextMaintenanceAt: new Date(end).toISOString(),
      revision: integer(row.revision, 'Level revision')
    });
  }
  async function readBetaLevelThreshold(level) {
    const result = await query(
      'select level,cumulative_xp from public.scout_level_thresholds ' +
        'where level in ($1::smallint,$2::smallint) order by level',
      [level, level + 1]
    );
    const rows = result?.rows;
    if (
      !Array.isArray(rows) ||
      rows.length !== 2 ||
      integer(rows[0].level, 'current level') !== level ||
      integer(rows[1].level, 'next level') !== level + 1
    )
      throw new Error('FORMAL_BETA_THRESHOLDS_UNAVAILABLE');
    const delta =
      integer(rows[1].cumulative_xp, 'next cumulative') -
      integer(rows[0].cumulative_xp, 'current cumulative');
    if (!Number.isSafeInteger(delta) || delta < 1)
      throw new Error('FORMAL_BETA_THRESHOLDS_INVALID');
    return delta;
  }
  async function readCanonicalPointHistory(userId) {
    if (!valid(userId)) throw new TypeError('Verified user ID required');
    assertReady();
    const response = await query(
      'select id,point_kind,point_value,status,occurred_at,event_key,reversal_of ' +
        'from public.scout_point_ledger where user_id=$1::uuid ' +
        'order by occurred_at desc,id desc limit 80',
      [userId]
    );
    if (!Array.isArray(response?.rows))
      throw new Error('FORMAL_CANONICAL_HISTORY_UNAVAILABLE');
    const result = [];
    for (const row of response.rows) {
      if (!valid(row.id)) throw new Error('FORMAL_HISTORY_ID_INVALID');
      const value = integer(row.point_value, 'ledger Point delta', -1000000);
      if (
        value > 1000000 ||
        !['confirmed', 'pending', 'frozen', 'cancelled'].includes(row.status)
      )
        throw new Error('FORMAL_HISTORY_ROW_INVALID');
      result.push({
        operationId: row.id,
        kind: row.reversal_of
          ? 'refund'
          : row.point_kind === 'formal_comment_reward'
            ? 'comment'
            : row.point_kind === 'formal_read_reward'
              ? 'read'
              : row.point_kind?.startsWith('formal_ai_')
                ? 'ai'
                : row.point_kind?.startsWith('formal_external_')
                  ? 'exchange'
                  : 'reward',
        points: value,
        status: row.status,
        at: iso(row.occurred_at)
      });
    }
    return result;
  }
  return Object.freeze({
    readFormalAccount,
    readCanonicalPointHistory,
    readCanonicalBalance,
    assertWalletCoherent
  });
}
