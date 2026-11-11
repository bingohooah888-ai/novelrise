// Formal opening sync for pre-release beta readers. Dormant, unregistered.
// Reads the already-10x-converted canonical ledger; NEVER multiplies by ten.
// The existing initialize_beta_level() remains the only Level seed writer.
// No app route or scheduled job invokes this module.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIT = 'beta_ten_points_per_yen';
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const MAX = Number.MAX_SAFE_INTEGER;

function pointInt(value) {
  const number =
    typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX)
    throw new Error('FORMAL_OPENING_POINT_INVALID');
  return number;
}
function timestamp(value) {
  const ms = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(ms))
    throw new TypeError('Trusted formal release timestamp required');
  return new Date(ms).toISOString();
}
function acceptedUnit(evidence, releaseAt) {
  return (
    evidence?.unitVersion === UNIT &&
    evidence?.cutoverVerifiedByTrustedServer === true &&
    evidence?.canonicalLedgerReconciled === true &&
    evidence?.formalReleaseAt === releaseAt
  );
}

const USER_SQL = 'select id,created_at from auth.users where id=$1::uuid';
const POINT_SQL =
  "select coalesce(sum(point_value) filter (where status='confirmed'),0)::text as net_points, " +
  "count(*) filter (where status<>'confirmed')::text as unresolved_rows, " +
  "count(*) filter (where occurred_at >= $2::timestamptz or point_kind like 'formal_%')::text as postrelease_rows " +
  'from public.scout_point_ledger where user_id=$1::uuid';
const LEVEL_SQL =
  'select user_id from novelight_formal_private.scout_level_state where user_id=$1::uuid';
const WALLET_SQL =
  'select user_id from novelight_formal_private.scout_point_usage_wallets where user_id=$1::uuid';
const INITIALIZE_LEVEL_SQL =
  'select novelight_formal_private.initialize_beta_level($1::uuid,$2::timestamptz) as result';
const SEED_WALLET_SQL =
  'insert into novelight_formal_private.scout_point_usage_wallets ' +
  '(user_id,available_points,exchange_eligible_points,reserved_points,held_points,revision) ' +
  'values($1::uuid,$2::bigint,0,0,0,0) returning user_id,available_points,exchange_eligible_points';

export function createUnregisteredFormalOpeningSync({
  pool,
  releaseAt,
  unitVerification,
  stagingRef = STAGING_REF
} = {}) {
  if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function')
    throw new TypeError('Trusted PostgreSQL pool required');
  const cutoff = timestamp(releaseAt);
  if (stagingRef !== STAGING_REF)
    throw new Error('FORMAL_OPENING_STAGING_ONLY');

  async function readCandidate(query, userId, lock = false) {
    const user = (await query(USER_SQL + (lock ? ' for update' : ''), [userId]))
      ?.rows?.[0];
    if (
      !user ||
      user.id !== userId ||
      !(Date.parse(user.created_at) < Date.parse(cutoff))
    )
      return Object.freeze({ status: 'not_pre_release_beta_reader' });
    const [point, level, wallet] = await Promise.all([
      query(POINT_SQL, [userId, cutoff]),
      query(LEVEL_SQL + (lock ? ' for update' : ''), [userId]),
      query(WALLET_SQL + (lock ? ' for update' : ''), [userId])
    ]);
    const summary = point?.rows?.[0];
    if (!summary) throw new Error('FORMAL_OPENING_LEDGER_UNAVAILABLE');
    const net = pointInt(summary.net_points);
    if (
      pointInt(summary.unresolved_rows) !== 0 ||
      pointInt(summary.postrelease_rows) !== 0
    )
      return Object.freeze({ status: 'opening_nonbeta_or_unsettled_hold' });
    if ((level?.rows?.length || 0) !== 0 || (wallet?.rows?.length || 0) !== 0)
      return Object.freeze({ status: 'opening_already_initialized_hold' });
    return Object.freeze({
      status: 'opening_seed_quote_only',
      userId,
      availablePoints: net,
      exchangeEligiblePoints: 0,
      reservedPoints: 0,
      heldPoints: 0,
      mayWriteDb: false
    });
  }

  async function inspect(userId) {
    if (!UUID.test(userId || ''))
      throw new TypeError('Trusted user ID required');
    if (!acceptedUnit(unitVerification, cutoff))
      return Object.freeze({ status: 'point_cutover_unverified_hold' });
    // Read-only preview, not a proof of an atomic source snapshot.
    const client = await pool.connect();
    try {
      // The transaction executor intentionally uses one database session.
      return await readCandidate(client.query.bind(client), userId);
    } finally {
      client.release();
    }
  }

  async function initializeOne(userId, authorization) {
    if (!UUID.test(userId || ''))
      throw new TypeError('Trusted user ID required');
    if (!acceptedUnit(unitVerification, cutoff))
      return Object.freeze({ status: 'point_cutover_unverified_hold' });
    // A separate, explicit Staging mutation approval is mandatory.
    if (
      authorization?.approved !== true ||
      authorization?.scope !== 'staging_formal_opening_bootstrap' ||
      authorization?.projectRef !== STAGING_REF ||
      authorization?.trustedServerVerified !== true ||
      authorization?.canonicalWritersQuiesced !== true
    )
      return Object.freeze({ status: 'formal_opening_write_not_approved' });
    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const proposed = await readCandidate(
        client.query.bind(client),
        userId,
        true
      );
      if (proposed.status !== 'opening_seed_quote_only') {
        await client.query('ROLLBACK');
        inTransaction = false;
        return proposed;
      }
      const initialized = (
        await client.query(INITIALIZE_LEVEL_SQL, [userId, cutoff])
      )?.rows?.[0]?.result;
      if (initialized?.status !== 'initialized_or_existing')
        throw new Error('FORMAL_OPENING_LEVEL_INIT_UNCONFIRMED');
      const created = await client.query(SEED_WALLET_SQL, [
        userId,
        proposed.availablePoints
      ]);
      if (
        created?.rows?.length !== 1 ||
        created.rows[0].user_id !== userId ||
        pointInt(created.rows[0].available_points) !==
          proposed.availablePoints ||
        pointInt(created.rows[0].exchange_eligible_points) !== 0
      )
        throw new Error('FORMAL_OPENING_WALLET_INIT_UNCONFIRMED');
      await client.query('COMMIT');
      inTransaction = false;
      return Object.freeze({
        status: 'opening_initialized',
        userId,
        availablePoints: proposed.availablePoints,
        level: initialized.level,
        exchangeEligiblePoints: 0
      });
    } catch (error) {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* propagate original */
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ inspect, initializeOne });
}
