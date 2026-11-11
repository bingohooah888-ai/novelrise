// Formal release application composition. Not a Vercel API route.
// Uses the existing canonical XP/Point readers, transactional usage service,
// authenticated HTTP handlers, and approved earning worker without starting them.
// This module creates no connection, migration, job, endpoint, or feature flag.
import { createUnregisteredFormalPostgresRewardHost } from './formal-usage-host.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';

export function createUnregisteredFormalApplication({
  pool,
  supabase,
  unitVerification,
  now,
  releaseConfiguration,
  trustedServerAuthorization,
  releaseTimestampIso,
  verifyModeratorReceipt,
  env,
  catalog,
  policy,
  aiExecutor,
  verifyGiftReceipt,
  verifyGiftNonFulfillment,
  verifyGiftRefund,
  verifyAiRefund
} = {}) {
  if (
    typeof pool?.connect !== 'function' ||
    typeof pool?.query !== 'function' ||
    typeof supabase?.auth?.getUser !== 'function'
  ) {
    throw new TypeError('Injected trusted PostgreSQL pool and Auth required');
  }
  // Read Level from scout_level_state and XP ledger; reconcile wallet to the
  // existing canonical Point ledger. No second source of truth is introduced.
  const usage = createUnregisteredFormalPostgresRewardHost({
    pool,
    supabase,
    unitVerification,
    now,
    releaseConfiguration,
    trustedServerAuthorization,
    env,
    catalog,
    policy,
    aiExecutor,
    verifyGiftReceipt,
    verifyGiftNonFulfillment,
    verifyGiftRefund,
    verifyAiRefund
  });
  // Formal read/comment earnings reuse the already implemented durable runner.
  // Its own launch gates remain disabled unless a future trusted host approves.
  const earnings = createFormalEarningRunner({
    postgresClient: pool,
    releaseTimestampIso,
    launchConfiguration: releaseConfiguration,
    trustedServerAuthorization,
    verifyModeratorReceipt
  });

  return Object.freeze({
    // Explicitly unregistered: an approved host must mount these later.
    readerHttp: usage.handlers.reader,
    adminHttp: usage.handlers.admin,
    getReaderSnapshot: usage.service.getReaderSnapshot,
    submitModeration: earnings.submitModeration,
    drainDueEarnings: earnings.drainDue,
    bindExistingScheduler: earnings.bindExistingScheduler
  });
}
