// Dormant formal maintenance review adapter for a trusted existing scheduler.
// Never creates a connection, cron, trigger, route or background timer.
// The only future writer is the already installed private 30-day review RPC.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_TICK = 25;
const DUE_SQL =
  'select user_id from novelight_formal_private.scout_level_state ' +
  "where coalesce(last_review_end_at,review_anchor_at) + interval '30 days' <= $1::timestamptz " +
  'order by coalesce(last_review_end_at,review_anchor_at),user_id limit $2::integer';
const REVIEW_SQL =
  'select novelight_formal_private.review_scout_30_days($1::uuid,$2::timestamptz) as result';

function validLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PER_TICK;
}

export function createUnregisteredFormalMaintenanceRunner({
  postgresClient,
  launchConfiguration,
  trustedServerAuthorization,
  now = () => new Date()
} = {}) {
  if (typeof postgresClient?.query !== 'function' || typeof now !== 'function')
    throw new TypeError('Trusted PostgreSQL reader and server clock required');

  // Separate from earnings and unrelated beta/contest cron approvals.
  const enabled = () =>
    launchConfiguration?.formalMaintenanceReviewEnabled === true &&
    launchConfiguration?.formalMaintenanceSchedulerEnabled === true &&
    launchConfiguration?.productionCutoverApproved === true &&
    trustedServerAuthorization?.serviceRoleVerified === true &&
    trustedServerAuthorization?.verifiedByTrustedServer === true;
  let running = false;

  async function reviewDue({ limit = 10 } = {}) {
    const counts = { reviewed: 0, alreadyReviewed: 0, held: 0 };
    if (!enabled())
      return Object.freeze({
        status: 'formal_maintenance_disabled',
        ...counts
      });
    if (!validLimit(limit))
      return Object.freeze({ status: 'invalid_review_limit', ...counts });
    if (running)
      return Object.freeze({
        status: 'review_tick_already_running',
        ...counts
      });
    let instant;
    try {
      instant = now();
    } catch {
      return Object.freeze({ status: 'review_clock_unavailable', ...counts });
    }
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()))
      return Object.freeze({ status: 'review_clock_unavailable', ...counts });

    running = true;
    try {
      const asOf = instant.toISOString();
      const due = await postgresClient.query(DUE_SQL, [asOf, limit]);
      if (!Array.isArray(due?.rows) || due.rows.length > limit)
        return Object.freeze({ status: 'review_source_invalid', ...counts });
      const seen = new Set();
      for (const row of due.rows) {
        const userId = row?.user_id;
        if (
          typeof userId !== 'string' ||
          !UUID.test(userId) ||
          seen.has(userId)
        )
          return Object.freeze({ status: 'review_source_invalid', ...counts });
        seen.add(userId);
      }
      for (const userId of seen) {
        // This SQL invokes a mutating SECURITY DEFINER function only after
        // a future independently authorized formal launch. No JS writes.
        const response = await postgresClient.query(REVIEW_SQL, [userId, asOf]);
        const result = response?.rows?.[0]?.result;
        if (result?.status === 'reviewed') counts.reviewed++;
        else if (result?.status === 'already_reviewed')
          counts.alreadyReviewed++;
        else if (result?.status === 'adjustment_policy_pending') counts.held++;
        else
          return Object.freeze({
            status: 'review_result_requires_attention',
            ...counts
          });
      }
      return Object.freeze({ status: 'review_tick_completed', ...counts });
    } catch {
      // Never leak private identity, DB errors or ledger values via a runner.
      return Object.freeze({ status: 'review_db_unavailable', ...counts });
    } finally {
      running = false;
    }
  }

  function bindExistingScheduler({ registerTick, limit = 10 } = {}) {
    if (!enabled())
      return Object.freeze({ status: 'formal_maintenance_disabled' });
    if (typeof registerTick !== 'function' || !validLimit(limit))
      return Object.freeze({ status: 'review_scheduler_binding_invalid' });
    // The caller owns an already existing scheduler; this is not registration
    // unless that separately approved caller injects registerTick.
    const registered = registerTick({
      taskKey: 'novelight-formal-maintenance-30d',
      run: () => reviewDue({ limit })
    });
    if (typeof registered?.unregister !== 'function')
      return Object.freeze({ status: 'review_scheduler_binding_incomplete' });
    return Object.freeze({
      status: 'review_scheduler_bound',
      unregister: registered.unregister
    });
  }

  return Object.freeze({ reviewDue, bindExistingScheduler });
}
