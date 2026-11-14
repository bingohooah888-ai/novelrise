// Dormant formal maintenance review adapter for a trusted existing scheduler.
// Never creates a connection, cron, trigger, route or background timer.
// The only future writer is the already installed private 30-day review RPC.
import { FORMAL_MAINTENANCE_SAFETY_APPROVED } from './formal-maintenance-release-gate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_TICK = 25;
// Old review_scout_30_days has no trusted XP source seal: never call it.
// These future private functions are NOT installed by this PR.
const DUE_SQL =
  'select user_id from ' +
  'novelight_formal_private.list_due_scout_30_day_reviews(' +
  '$1::timestamptz,$2::integer)';
const REVIEW_SQL =
  'select novelight_formal_private.review_scout_30_days_sealed(' +
  '$1::uuid,$2::timestamptz) as result';
const DUE_RPC =
  'novelight_formal_private.list_due_scout_30_day_reviews(timestamptz,integer)';
const SEALED_REVIEW_RPC =
  'novelight_formal_private.review_scout_30_days_sealed(uuid,timestamptz)';
// The injected server role requires private RPC EXECUTE, not private table SELECT.
// Missing functions or accidental anon/authenticated EXECUTE => unready.
const ACCESS_SQL =
  "select (has_schema_privilege(current_user,'novelight_formal_private','USAGE') " +
  "and coalesce(has_function_privilege(current_user,to_regprocedure('" +
  DUE_RPC +
  "'),'EXECUTE'),false) " +
  "and coalesce(has_function_privilege(current_user,to_regprocedure('" +
  SEALED_REVIEW_RPC +
  "'),'EXECUTE'),false) " +
  "and not coalesce(has_function_privilege('anon',to_regprocedure('" +
  DUE_RPC +
  "'),'EXECUTE'),false) " +
  "and not coalesce(has_function_privilege('authenticated',to_regprocedure('" +
  DUE_RPC +
  "'),'EXECUTE'),false) " +
  "and not coalesce(has_function_privilege('anon',to_regprocedure('" +
  SEALED_REVIEW_RPC +
  "'),'EXECUTE'),false) " +
  "and not coalesce(has_function_privilege('authenticated',to_regprocedure('" +
  SEALED_REVIEW_RPC +
  "'),'EXECUTE'),false)) as ready";

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
    FORMAL_MAINTENANCE_SAFETY_APPROVED === true &&
    launchConfiguration?.formalMaintenanceReviewEnabled === true &&
    launchConfiguration?.formalMaintenanceSchedulerEnabled === true &&
    launchConfiguration?.productionCutoverApproved === true &&
    trustedServerAuthorization?.serviceRoleVerified === true &&
    trustedServerAuthorization?.verifiedByTrustedServer === true;
  let running = false;

  // Read-only preflight: no privilege changes and no review invocation.
  async function inspectConnectionReadiness() {
    try {
      const result = await postgresClient.query(ACCESS_SQL);
      if (
        !Array.isArray(result?.rows) ||
        result.rows.length !== 1 ||
        typeof result.rows[0]?.ready !== 'boolean'
      )
        return Object.freeze({ status: 'maintenance_connection_unavailable' });
      return Object.freeze({
        status: result.rows[0].ready
          ? 'maintenance_connection_ready'
          : 'maintenance_connection_unready'
      });
    } catch {
      return Object.freeze({ status: 'maintenance_connection_unavailable' });
    }
  }

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
      const readiness = await inspectConnectionReadiness();
      if (readiness.status !== 'maintenance_connection_ready')
        return Object.freeze({ status: readiness.status, ...counts });
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
        // Only the future sealed RPC may review: it must serialize XP writes,
        // prove the period is final and handle corrections atomically.
        // There is no fallback to the currently installed unsealed RPC.
        const response = await postgresClient.query(REVIEW_SQL, [userId, asOf]);
        const result = response?.rows?.[0]?.result;
        if (result?.status === 'reviewed') counts.reviewed++;
        else if (result?.status === 'already_reviewed')
          counts.alreadyReviewed++;
        else if (
          result?.status === 'held' ||
          result?.status === 'window_unsealed' ||
          result?.status === 'late_xp_pending' ||
          result?.status === 'beta_cutover_pending' ||
          result?.status === 'adjustment_policy_pending'
        )
          counts.held++;
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

  return Object.freeze({
    inspectConnectionReadiness,
    reviewDue,
    bindExistingScheduler
  });
}
