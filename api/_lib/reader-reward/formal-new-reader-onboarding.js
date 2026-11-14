// Dormant post-release reader onboarding for fresh Auth users only.
// Keeps all pre-release Point/XP history untouched, including unresolved IDs.
// No route, trigger, secret, or DB connection is registered by this module.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const USER_SQL = 'select id,created_at from auth.users where id=$1::uuid';
const COUNTS_SQL =
  'select ' +
  '(select count(*)::text from public.scout_point_ledger where user_id=$1::uuid) as point_rows,' +
  '(select count(*)::text from public.scout_xp_ledger where user_id=$1::uuid) as xp_rows,' +
  '(select count(*)::text from novelight_formal_private.scout_level_state where user_id=$1::uuid) as level_rows,' +
  '(select count(*)::text from novelight_formal_private.scout_point_usage_wallets where user_id=$1::uuid) as wallet_rows';
const LEVEL_INSERT =
  'insert into novelight_formal_private.scout_level_state ' +
  '(user_id,current_level,highest_level,level_progress_xp,review_anchor_at,revision) ' +
  'values ($1::uuid,1,1,0,$2::timestamptz,0) on conflict (user_id) do nothing returning user_id';
const WALLET_INSERT =
  'insert into novelight_formal_private.scout_point_usage_wallets ' +
  '(user_id,available_points,exchange_eligible_points,reserved_points,held_points,revision) ' +
  'values ($1::uuid,0,0,0,0,0) on conflict (user_id) do nothing returning user_id';
const SUMMARY_SQL =
  'select count(*)::text as registered_post_release, ' +
  'count(*) filter (where l.user_id is not null and w.user_id is not null)::text as ready, ' +
  'count(*) filter (where (l.user_id is null) <> (w.user_id is null))::text as partial ' +
  'from auth.users u ' +
  'left join novelight_formal_private.scout_level_state l on l.user_id=u.id ' +
  'left join novelight_formal_private.scout_point_usage_wallets w on w.user_id=u.id ' +
  'where u.created_at >= $1::timestamptz';

const nonnegative = (v) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error('FORMAL_NEW_READER_COUNT_INVALID');
  return n;
};
const frozen = (status, extra = {}) => Object.freeze({ status, ...extra });
export function createUnregisteredFormalNewReaderOnboarding({
  pool,
  releaseAt,
  stagingTestReferenceAt,
  now = Date.now,
  stagingRef = STAGING,
  releaseConfiguration,
  trustedServerAuthorization
} = {}) {
  if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function')
    throw new TypeError('Trusted PostgreSQL pool required');
  // A Staging synthetic time anchor is NOT the actual release timestamp.
  // No caller may supply both or silently promote a test reference to release.
  if (releaseAt !== undefined && stagingTestReferenceAt !== undefined)
    throw new TypeError(
      'Release and Staging proof references must be separate'
    );
  const testReference = stagingTestReferenceAt !== undefined;
  const referenceAt = testReference ? stagingTestReferenceAt : releaseAt;
  if (
    typeof now !== 'function' ||
    typeof referenceAt !== 'string' ||
    !Number.isFinite(Date.parse(referenceAt))
  )
    throw new TypeError(
      'Trusted formal or Staging proof timestamp/clock required'
    );
  if (stagingRef !== STAGING) throw new Error('FORMAL_NEW_READER_STAGING_ONLY');
  const releaseMs = Date.parse(referenceAt);
  const releaseIso = new Date(releaseMs).toISOString();
  const referenceMode = testReference
    ? 'staging_synthetic_one_reader_proof'
    : 'formal_release_single_reader';
  const enabled = (userId) =>
    releaseConfiguration?.formalNewReaderOnboardingEnabled === true &&
    trustedServerAuthorization?.approved === true &&
    trustedServerAuthorization?.scope ===
      'staging_formal_new_reader_onboarding' &&
    trustedServerAuthorization?.projectRef === STAGING &&
    trustedServerAuthorization?.trustedServerVerified === true &&
    trustedServerAuthorization?.approvedUserId === userId &&
    UUID.test(trustedServerAuthorization?.approvedUserId || '') &&
    trustedServerAuthorization?.maxReaders === 1 &&
    trustedServerAuthorization?.referenceMode === referenceMode &&
    trustedServerAuthorization?.approvedReferenceAt === releaseIso &&
    now() >= releaseMs;
  async function inspect(query, userId, locked = false) {
    if (!UUID.test(userId || ''))
      throw TypeError('Verified reader UUID required');
    const user = (
      await query(USER_SQL + (locked ? ' for update' : ''), [userId])
    )?.rows?.[0];
    if (!user || user.id !== userId)
      return frozen('new_reader_auth_missing_hold');
    return inspectFromAuthCreatedAt(query, userId, user.created_at);
  }
  async function inspectFromAuthCreatedAt(query, userId, createdAt) {
    const created = Date.parse(createdAt);
    if (!Number.isFinite(created) || created < releaseMs || created > now())
      return frozen('not_post_release_reader_hold');
    const row = (await query(COUNTS_SQL, [userId]))?.rows?.[0];
    if (!row) throw Error('FORMAL_NEW_READER_COUNTS_UNAVAILABLE');
    const counts = Object.freeze({
      pointRows: nonnegative(row.point_rows),
      xpRows: nonnegative(row.xp_rows),
      levelRows: nonnegative(row.level_rows),
      walletRows: nonnegative(row.wallet_rows)
    });
    if (counts.pointRows || counts.xpRows)
      return frozen('new_reader_has_prior_activity_hold', { counts });
    if (counts.levelRows > 1 || counts.walletRows > 1)
      throw Error('FORMAL_NEW_READER_STATE_INVALID');
    if (counts.levelRows === 1 && counts.walletRows === 1)
      return frozen('new_reader_already_initialized', { counts });
    if (counts.levelRows || counts.walletRows)
      return frozen('new_reader_partial_state_hold', { counts });
    return frozen('new_reader_ready_for_initialization', {
      counts,
      reviewAnchorAt: new Date(created).toISOString(),
      initialLevel: 1,
      initialAvailablePoints: 0,
      initialExchangeEligiblePoints: 0
    });
  }
  const inspectOne = (userId) => inspect(pool.query.bind(pool), userId);

  // Synthetic Staging read-only proof: the server's already verified
  // Supabase Auth getUser(token) result is the identity + creation source.
  // Never query auth.users through the constrained SQL reader.
  async function inspectVerifiedOne(user) {
    if (!testReference) return frozen('new_reader_verified_staging_only_hold');
    if (
      !UUID.test(user?.id || '') ||
      typeof user.created_at !== 'string' ||
      !Number.isFinite(Date.parse(user.created_at))
    )
      return frozen('new_reader_auth_proof_unavailable_hold');
    const created = Date.parse(user.created_at);
    if (created < releaseMs || created > now())
      return frozen('not_post_release_reader_hold');
    if (typeof pool.withVerifiedReaderQuery !== 'function')
      return frozen('new_reader_read_scope_unavailable_hold');
    return pool.withVerifiedReaderQuery(user.id, (query) =>
      inspectFromAuthCreatedAt(query, user.id, user.created_at)
    );
  }

  async function getAdminSummary() {
    // Aggregated post-release Auth-only status; no legacy population is skipped
    // or modified by this read-only report.
    const result = (await pool.query(SUMMARY_SQL, [releaseIso]))?.rows?.[0];
    if (!result) throw Error('FORMAL_NEW_READER_SUMMARY_UNAVAILABLE');
    return frozen('new_reader_summary_ready', {
      totalRegistered: nonnegative(result.registered_post_release),
      initialized: nonnegative(result.ready),
      partial: nonnegative(result.partial),
      referenceAt: releaseIso,
      referenceMode,
      legacyPointMigrationUnaffected: true
    });
  }
  async function initializeOne(userId) {
    if (!UUID.test(userId || ''))
      throw TypeError('Verified reader UUID required');
    if (!enabled(userId)) return frozen('new_reader_initialization_disabled');
    const client = await pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const current = await inspect(client.query.bind(client), userId, true);
      if (current.status !== 'new_reader_ready_for_initialization') {
        await client.query('ROLLBACK');
        begun = false;
        return current;
      }
      const level = await client.query(LEVEL_INSERT, [
        userId,
        current.reviewAnchorAt
      ]);
      if (level?.rows?.length !== 1 || level.rows[0].user_id !== userId)
        throw Error('FORMAL_NEW_READER_LEVEL_NOT_CREATED');
      const wallet = await client.query(WALLET_INSERT, [userId]);
      if (wallet?.rows?.length !== 1 || wallet.rows[0].user_id !== userId)
        throw Error('FORMAL_NEW_READER_WALLET_NOT_CREATED');
      await client.query('COMMIT');
      begun = false;
      return frozen('new_reader_initialized', {
        initialLevel: 1,
        initialAvailablePoints: 0,
        initialExchangeEligiblePoints: 0
      });
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* original error wins */
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
  return Object.freeze({
    inspectOne,
    inspectVerifiedOne,
    getAdminSummary,
    initializeOne
  });
}
